// YouTube URL parsing & transcript fetching utilities

import { TranscriptSegment } from "./types";

/**
 * Extract the YouTube video ID from various URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 */
export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();

  // Direct 11-char video id
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /(?:m\.youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

export function getThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function getEmbedUrl(videoId: string, start?: number, end?: number): string {
  let url = `https://www.youtube.com/embed/${videoId}`;
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
  });
  if (start !== undefined) params.set("start", String(Math.floor(start)));
  if (end !== undefined) params.set("end", String(Math.ceil(end)));
  return `${url}?${params.toString()}`;
}

export function formatTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  // Preserve 1 decimal place for subtitle sync precision
  const secsStr = Number.isInteger(secs) ? String(secs).padStart(2, "0") : secs.toFixed(1).padStart(4, "0");
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${secsStr}`;
  }
  return `${mins}:${secsStr}`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Fetch video metadata (title, channel, duration) from YouTube oEmbed API.
 * This is a public endpoint that doesn't require an API key.
 */
export async function fetchVideoMeta(videoId: string): Promise<{
  title: string | null;
  channel: string | null;
  thumbnail: string;
}> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title ?? null,
        channel: data.author_name ?? null,
        thumbnail: getThumbnailUrl(videoId),
      };
    }
  } catch {
    // fall through
  }
  return {
    title: null,
    channel: null,
    thumbnail: getThumbnailUrl(videoId),
  };
}

/**
 * Fetch the transcript for a YouTube video.
 *
 * Strategy (tries multiple methods since YouTube blocks cloud IPs):
 *  1. youtubei.js (Innertube API) WITH cookies — best at bypassing rate limits
 *  2. youtube-transcript package with multiple languages
 *  3. Scrape YouTube watch page for caption tracks
 *
 * YouTube only provides transcripts when the video creator has enabled
 * captions OR YouTube has auto-generated them. Many videos (especially
 * Indonesian comedy/entertainment) have neither, in which case we throw
 * a clear, actionable error.
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const primaryError: string[] = [];

  // 0. Load YouTube cookies (same as video download)
  const cookiesFile = await loadCookiesForTranscript();
  const hasCookies = cookiesFile !== null;
  console.log(`[transcript] fetching for ${videoId} (cookies: ${hasCookies ? "YES" : "NO"})`);

  // 1. Try youtubei.js WITH cookies (Innertube API — most reliable on cloud)
  if (hasCookies) {
    try {
      const segments = await fetchTranscriptWithYoutubei(videoId, cookiesFile!);
      if (segments.length > 0) {
        console.log(`[transcript] ✅ youtubei.js + cookies: ${segments.length} segments`);
        return segments;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      primaryError.push(`youtubei+cookies: ${msg.split("\n")[0]}`);
      console.warn(`[transcript] youtubei.js + cookies failed:`, msg.slice(0, 200));
    }
  }

  // 2. Try youtube-transcript package with multiple languages
  //    Note: English first is safer — Indonesian auto-captions on YouTube are
  //    often inaccurate. English captions (including auto-generated) are
  //    typically much more reliable, even for Indonesian videos.
  const languages = ["en", "en-US", "en-GB", "id"];
  for (const lang of languages) {
    try {
      const { YoutubeTranscript } = await import("youtube-transcript");
      const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      if (segments && segments.length > 0) {
        console.log(`[transcript] ✅ youtube-transcript (${lang}): ${segments.length} segments`);
        return segments.map((s) => ({
          text: (s.text || "")
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .trim(),
          start: Number(s.offset ?? s.start ?? 0),
          duration: Number(s.duration ?? 0),
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      primaryError.push(`${lang}: ${msg.split("\n")[0]}`);
      // continue to next language
    }
  }

  // 3. Fallback: scrape YouTube watch page with cookies for caption tracks
  try {
    const segments = await fetchTranscriptFromPage(videoId, cookiesFile);
    if (segments.length > 0) {
      console.log(`[transcript] ✅ page-scrape: ${segments.length} segments`);
      return segments;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    primaryError.push(`page-scrape: ${msg.split("\n")[0]}`);
  }

  // 4. All attempts failed — throw a clear, actionable error.
  let hint = "";
  if (!hasCookies) {
    hint =
      " SOLUTION: Set YOUTUBE_COOKIES env var on Railway (see .env.example). " +
      "YouTube is rate-limiting this server's IP — cookies bypass this.";
  }
  throw new Error(
    "This video doesn't have captions or a transcript available. " +
      "YouTube only provides transcripts when the creator has enabled subtitles " +
      "or auto-captions exist, OR YouTube is rate-limiting this server's IP." +
      hint +
      " (Details: " +
      primaryError.join("; ") +
      ")"
  );
}

/**
 * Load YouTube cookies from YOUTUBE_COOKIES env var (shared with video-processor).
 * Returns the cookies.txt file path, or null if not set.
 */
let transcriptCookiesFile: string | null = null;
let transcriptCookiesLoaded = false;

async function loadCookiesForTranscript(): Promise<string | null> {
  if (transcriptCookiesLoaded) return transcriptCookiesFile;
  transcriptCookiesLoaded = true;

  const encoded = process.env.YOUTUBE_COOKIES;
  if (!encoded || encoded.trim() === "") {
    return null;
  }

  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    if (!decoded.includes(".youtube.com")) {
      console.warn("[transcript] YOUTUBE_COOKIES doesn't look like Netscape cookies.txt");
      return null;
    }

    const cacheDir = join(tmpdir(), "viralclip-videos", "downloads");
    if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
    const cookiesPath = join(cacheDir, "youtube-cookies.txt");
    await writeFile(cookiesPath, decoded, "utf-8");
    transcriptCookiesFile = cookiesPath;
    console.log(`[transcript] loaded YouTube cookies: ${cookiesPath}`);
    return cookiesPath;
  } catch (err) {
    console.warn(
      "[transcript] failed to decode YOUTUBE_COOKIES:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Fetch transcript using youtubei.js (Innertube API) with cookies.
 * This uses YouTube's internal API which is more resilient to rate limiting
 * and supports cookie-based authentication.
 */
async function fetchTranscriptWithYoutubei(
  videoId: string,
  cookiesFile: string
): Promise<TranscriptSegment[]> {
  const { readFile } = await import("node:fs/promises");
  const Innertube = (await import("youtubei.js")).default;

  const cookiesContent = await readFile(cookiesFile, "utf-8");
  const cookieHeader = netscapeToCookieHeader(cookiesContent);
  if (!cookieHeader) {
    throw new Error("No valid cookies found in cookies file");
  }

  const youtube = await Innertube.create({ cookie: cookieHeader });
  console.log(`[transcript][youtubei] fetching transcript for ${videoId}...`);

  // youtubei.js has a getTranscript() method that returns timed text
  const transcript = await youtube.getTranscript(videoId);
  if (!transcript || !transcript.content) {
    throw new Error("youtubei.js returned empty transcript");
  }

  // transcript.content is an array of { text, startMs, durationMs }
  const segments: TranscriptSegment[] = transcript.content
    .filter((line: any) => line.text)
    .map((line: any) => ({
      text: String(line.text).trim(),
      start: Number(line.startMs ?? 0) / 1000, // ms → seconds
      duration: Number(line.durationMs ?? 0) / 1000,
    }));

  if (segments.length === 0) {
    throw new Error("youtubei.js transcript has no content");
  }

  return segments;
}

/**
 * Convert Netscape cookies.txt format to HTTP Cookie header string.
 */
function netscapeToCookieHeader(content: string): string {
  const pairs: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 7) {
      const name = parts[5];
      const value = parts[6];
      if (name && value) {
        pairs.push(`${name}=${value}`);
      }
    }
  }
  return pairs.join("; ");
}

async function fetchTranscriptFromPage(
  videoId: string,
  cookiesFile: string | null = null
): Promise<TranscriptSegment[]> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Build headers — include Cookie header if cookies file is available
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };

  if (cookiesFile) {
    try {
      const { readFile } = await import("node:fs/promises");
      const cookiesContent = await readFile(cookiesFile, "utf-8");
      const cookieHeader = netscapeToCookieHeader(cookiesContent);
      if (cookieHeader) {
        headers["Cookie"] = cookieHeader;
        console.log(`[transcript][page-scrape] using cookies`);
      }
    } catch {
      // ignore cookie load errors
    }
  }

  const res = await fetch(watchUrl, {
    headers,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`YouTube page returned status ${res.status}`);
  }
  const html = await res.text();

  // Find the captionTracks JSON in ytInitialPlayerResponse
  const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
  if (!captionMatch) {
    // Try without captions - some videos genuinely have none
    if (html.includes('"captions":{}') || html.includes('"captionTracks":[]')) {
      throw new Error("This video has no captions/subtitles available.");
    }
    throw new Error("Could not locate caption tracks on the YouTube page.");
  }

  let tracks: Array<{ baseUrl: string; languageCode: string; name?: { simpleText?: string } }> = [];
  try {
    // The regex above may stop too early; rebuild with a balanced parser
    const idx = html.indexOf('"captionTracks":');
    if (idx >= 0) {
      const start = html.indexOf("[", idx);
      const end = findBalancedEnd(html, start, "[", "]");
      const jsonStr = html.slice(start, end + 1);
      tracks = JSON.parse(jsonStr);
    }
  } catch {
    tracks = [];
  }

  if (tracks.length === 0) {
    throw new Error("No caption tracks found for this video.");
  }

  // Prefer English, otherwise take the first track
  const track =
    tracks.find((t) => t.languageCode.startsWith("en")) ?? tracks[0];

  const transcriptUrl = track.baseUrl + "&fmt=json3";
  const tres = await fetch(transcriptUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!tres.ok) {
    throw new Error(`Transcript fetch returned status ${tres.status}`);
  }
  const data = await tres.json();

  const events: Array<{ tStartMs: number; dDurationMs: number; segs?: Array<{ utf8: string }> }> =
    data?.events ?? [];

  const segments: TranscriptSegment[] = [];
  for (const ev of events) {
    const text = (ev.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\n/g, " ").trim();
    if (!text) continue;
    segments.push({
      text,
      start: (ev.tStartMs ?? 0) / 1000,
      duration: (ev.dDurationMs ?? 0) / 1000,
    });
  }

  return segments;
}

function findBalancedEnd(s: string, startIdx: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return s.length - 1;
}

/**
 * Build a single text transcript with [mm:ss] timestamps, chunked to keep
 * each chunk small enough for the LLM context window.
 */
export function buildTranscriptText(segments: TranscriptSegment[]): {
  text: string;
  duration: number;
} {
  if (segments.length === 0) return { text: "", duration: 0 };
  const last = segments[segments.length - 1];
  const duration = last.start + (last.duration || 0);

  const lines = segments.map((s) => {
    const ts = formatTimestamp(s.start);
    return `[${ts}] ${s.text}`;
  });
  return { text: lines.join("\n"), duration };
}
