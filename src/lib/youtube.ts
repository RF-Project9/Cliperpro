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
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
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
 * Fetch the transcript for a YouTube video using the youtube-transcript package,
 * with a manual fallback that scrapes the YouTube watch page for caption tracks.
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  // Primary: use the youtube-transcript package
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const segments = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: "en",
    });
    if (segments && segments.length > 0) {
      return segments.map((s) => ({
        text: (s.text || "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim(),
        start: Number(s.offset ?? s.start ?? 0),
        duration: Number(s.duration ?? 0),
      }));
    }
  } catch (err) {
    console.warn("[transcript] primary fetch failed, trying fallback:", err instanceof Error ? err.message : err);
  }

  // Fallback: scrape YouTube watch page for caption tracks
  try {
    const segments = await fetchTranscriptFromPage(videoId);
    if (segments.length > 0) return segments;
  } catch (err) {
    console.warn("[transcript] fallback fetch failed:", err instanceof Error ? err.message : err);
  }

  throw new Error(
    "Could not fetch transcript for this video. The video may not have captions/subtitles enabled, or it may be private/age-restricted."
  );
}

async function fetchTranscriptFromPage(videoId: string): Promise<TranscriptSegment[]> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(watchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
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
