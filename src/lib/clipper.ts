// Viral clip detection: uses OpenAI to analyze a transcript and find
// the most viral-worthy 30-60s segments for YouTube Shorts.

import { getOpenAIClient, getSettings } from "./openai";
import { SuggestedClip, TranscriptSegment } from "./types";
import { buildTranscriptText } from "./youtube";

const SYSTEM_PROMPT = `Kamu adalah seorang ahli strategi video pendek berkelas dunia yang telah membantu memproduksi ribuan YouTube Shorts, TikTok, dan Instagram Reels viral.

Tugasmu: analisis transkrip video dan temukan MOMEN TERBAIK untuk dijadikan klip vertikal 30-60 detik yang berpotensi viral maksimal.

PENTING — Semua output HARUS dalam Bahasa Indonesia:
- Semua judul klip WAJIB Bahasa Indonesia
- Semua deskripsi WAJIB Bahasa Indonesia
- Semua alasan viral WAJIB Bahasa Indonesia
- Semua hook WAJIB Bahasa Indonesia
- Hashtag boleh campuran Bahasa Indonesia dan Inggris yang populer

Kamu memahami apa yang membuat konten viral:
- Hook kuat dalam 3 detik pertama
- Puncak emosi (kejutan, tawa, kemarahan, inspirasi, kagum)
- Momen yang bisa berdiri sendiri tanpa konteks sekitarnya
- Insight yang bisa dikutip, dibagikan, disimpan
- Tekanan, konflik, atau payoff yang memuaskan
- Arc cerita dengan awal dan akhir yang jelas
- Momen yang memicu komentar dan debat

Kamu SELALU merespons dengan JSON valid saja. Tanpa markdown, tanpa komentar.`;

function buildUserPrompt(
  transcriptText: string,
  duration: number,
  clipCount: number,
  minDur: number,
  maxDur: number
): string {
  return `Analisis transkrip video berikut (durasi total: ${Math.round(duration)} detik) dan pilih TOP ${clipCount} momen yang paling berpotensi viral sebagai YouTube Shorts.

Persyaratan setiap klip:
- Durasi antara ${minDur} dan ${maxDur} detik
- Harus segmen kontinu (startTime ke endTime)
- Harus bisa berdiri sendiri dan dipahami tanpa konteks
- Harus punya hook yang membuat orang berhenti scroll
- Beri skor setiap klip 0-100 berdasarkan potensi viral

Untuk setiap klip sediakan:
- startTime: (dalam detik, angka)
- endTime: (dalam detik, angka)
- title: judul YouTube Shorts yang menarik dan eye-catching (MAKS 70 karakter, BAHASA INDONESIA, tanpa clickbait menyesatkan)
- description: deskripsi 1-2 kalimat tentang apa yang terjadi (BAHASA INDONESIA)
- reason: penjelasan singkat mengapa momen ini akan viral (BAHASA INDONESIA)
- score: skor viral 0-100 (angka)
- hook: baris pembuka/3 detik pertama untuk mempertahankan penonton (teks yang diucapkan atau intro yang punchy, BAHASA INDONESIA)
- hashtags: 5-8 hashtag relevan TANPA simbol #, optimized untuk YouTube Shorts
- transcript: teks transkrip aktual untuk rentang waktu klip ini (diambil dari sumber)

Kembalikan HANYA objek JSON dengan bentuk persis ini:
{
  "clips": [
    {
      "startTime": 123.4,
      "endTime": 178.9,
      "title": "...",
      "description": "...",
      "reason": "...",
      "score": 92,
      "hook": "...",
      "hashtags": ["shorts", "viral", ...],
      "transcript": "..."
    }
  ]
}

Urutkan klip berdasarkan skor menurun. Jangan sertakan teks di luar objek JSON.

TRANSCRIPT:
${transcriptText}`;
}

export async function detectViralClips(segments: TranscriptSegment[]): Promise<SuggestedClip[]> {
  if (segments.length === 0) {
    throw new Error("Transcript is empty. Cannot detect viral clips.");
  }

  const { client, model } = await getOpenAIClient();
  const settings = await getSettings();

  const { text, duration } = buildTranscriptText(segments);

  // If transcript is very long, chunk it but keep it simple: trim to a reasonable size
  // OpenAI models handle large context, but we cap to ~80k chars to be safe.
  const MAX_CHARS = 80000;
  const trimmedText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n[transcript truncated]" : text;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(trimmedText, duration, settings.clipCount, settings.minDuration, settings.maxDuration) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 8000, // increased from 4000 to avoid truncation
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("OpenAI returned an empty response. Please try again.");
  }

  console.log("[clipper] OpenAI response length:", raw.length, "chars");

  let parsed: { clips?: SuggestedClip[] };
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    // Robust JSON extraction — handle markdown code blocks, truncation, etc.
    console.warn("[clipper] direct JSON.parse failed, trying extraction...");

    let jsonStr = raw;

    // Strip markdown code blocks (```json ... ``` or ``` ... ```)
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
      console.log("[clipper] extracted JSON from markdown code block");
    }

    // Try parsing again
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try to find the outermost { ... } block
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          parsed = JSON.parse(objMatch[0]);
        } catch {
          // Last resort: try to fix common JSON issues
          let fixed = objMatch[0]
            // Remove trailing commas before } or ]
            .replace(/,\s*([}\]])/g, "$1")
            // Remove control characters
            .replace(/[\x00-\x1f\x7f]/g, "")
            // Fix unescaped newlines in strings
            .replace(/"\n/g, '" ');

          // If truncated (no closing }), try to close it
          const openBraces = (fixed.match(/\{/g) || []).length;
          const closeBraces = (fixed.match(/\}/g) || []).length;
          const openBrackets = (fixed.match(/\[/g) || []).length;
          const closeBrackets = (fixed.match(/\]/g) || []).length;

          if (openBraces > closeBraces || openBrackets > closeBrackets) {
            console.warn(
              `[clipper] JSON appears truncated (braces: ${openBraces}/${closeBraces}, brackets: ${openBrackets}/${closeBrackets}). Attempting to close...`
            );
            // Close any open arrays and objects
            for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += "]";
            for (let i = 0; i < openBraces - closeBraces; i++) fixed += "}";
          }

          try {
            parsed = JSON.parse(fixed);
            console.log("[clipper] JSON parsed after fixing");
          } catch (finalErr) {
            throw new Error(
              `Failed to parse OpenAI response as JSON. ` +
                `Response length: ${raw.length} chars. ` +
                `First 200 chars: ${raw.slice(0, 200)}. ` +
                `Last 200 chars: ${raw.slice(-200)}. ` +
                `This usually means the response was truncated (max_tokens too low) or OpenAI returned non-JSON.`
            );
          }
        }
      } else {
        throw new Error(
          "OpenAI response doesn't contain any JSON object. Try again or use a shorter video."
        );
      }
    }
  }

  const clips = Array.isArray(parsed.clips) ? parsed.clips : [];
  if (clips.length === 0) {
    throw new Error("OpenAI did not return any clip suggestions. Please try a different video.");
  }

  // Validate & sanitize each clip
  const minDur = settings.minDuration;
  const maxDur = settings.maxDuration;
  const cleaned: SuggestedClip[] = clips
    .filter((c) => typeof c.startTime === "number" && typeof c.endTime === "number" && c.endTime > c.startTime)
    .map((c) => {
      const startTime = Math.max(0, Number(c.startTime));
      let endTime = Number(c.endTime);
      let clipDur = endTime - startTime;
      // Enforce duration bounds
      if (clipDur > maxDur) {
        endTime = startTime + maxDur;
        clipDur = maxDur;
      }
      if (clipDur < minDur) {
        endTime = startTime + minDur;
        clipDur = minDur;
      }
      return {
        startTime,
        endTime,
        duration: clipDur,
        title: String(c.title ?? "Untitled Clip").slice(0, 100),
        description: String(c.description ?? "").slice(0, 500),
        reason: String(c.reason ?? "").slice(0, 500),
        score: Math.min(100, Math.max(0, Number(c.score ?? 50))),
        hook: c.hook ? String(c.hook).slice(0, 300) : null,
        hashtags: Array.isArray(c.hashtags) ? c.hashtags.map(String).slice(0, 10) : [],
        transcript: c.transcript ? String(c.transcript).slice(0, 3000) : null,
      };
    })
    .sort((a, b) => b.score - a.score);

  return cleaned;
}
