// Viral clip detection: uses OpenAI to analyze a transcript and find
// the most viral-worthy 30-60s segments for YouTube Shorts.

import { getOpenAIClient, getSettings } from "./openai";
import { SuggestedClip, TranscriptSegment } from "./types";
import { buildTranscriptText } from "./youtube";

const SYSTEM_PROMPT = `You are a world-class short-form video strategist and content clipper who has helped produce thousands of viral YouTube Shorts, TikToks, and Instagram Reels.

Your job: analyze the transcript of a long-form video and identify the BEST moments to clip into 30-60 second vertical Shorts that have maximum viral potential.

You deeply understand what makes content go viral:
- Strong hooks in the first 3 seconds
- Emotional peaks (surprise, laughter, outrage, inspiration, awe)
- Self-contained moments that make sense without surrounding context
- quotable, shareable, saveable insights
- Tension, conflict, or a satisfying payoff
- Story arcs with a clear beginning and end
- Moments that trigger comments and debate

You ALWAYS respond with valid JSON only. No markdown, no commentary.`;

function buildUserPrompt(
  transcriptText: string,
  duration: number,
  clipCount: number,
  minDur: number,
  maxDur: number
): string {
  return `Analyze the following video transcript (total duration: ${Math.round(duration)}s) and select the TOP ${clipCount} moments most likely to go viral as YouTube Shorts.

Requirements for each clip:
- Duration between ${minDur} and ${maxDur} seconds
- Must be a contiguous segment (startTime to endTime)
- Must be self-contained and understandable on its own
- Must have a scroll-stopping hook
- Score each clip 0-100 based on viral potential

For each clip provide:
- startTime: (in seconds, number)
- endTime: (in seconds, number)
- title: a catchy, click-worthy YouTube Shorts title (max 70 chars, NO clickbait that misleads)
- description: a 1-2 sentence description of what happens
- reason: a concise explanation of why this moment will go viral
- score: virality score 0-100 (number)
- hook: the exact opening line/first 3 seconds to retain viewers (the actual spoken text or a punchy intro)
- hashtags: 5-8 relevant hashtags WITHOUT the # symbol, optimized for YouTube Shorts discovery
- transcript: the actual transcript text for this clip's time range (taken from the source)

Return ONLY a JSON object with this exact shape:
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

Order clips by score descending. Do not include any text outside the JSON object.

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
