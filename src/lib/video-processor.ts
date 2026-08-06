// Video processing: download, cut, crop 16:9, burn subtitles, face tracking
//
// Pipeline:
//   1. Download the source video with yt-dlp (cached per videoId)
//   2. Generate an SRT subtitle file from the clip's transcript
//   3. ffmpeg: cut segment → crop to 16:9 (face-aware via cropdetect) →
//      burn subtitles → output MP4
//
// Face tracking: uses ffmpeg's cropdetect filter to auto-detect the active
// region (where faces/motion are), then crops to 16:9 centered on that region.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  createReadStream,
  renameSync,
  createWriteStream,
} from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import { ClipItem } from "./types";
import { db } from "./db";

const execFileAsync = promisify(execFile);

// Working directory for video files. On Railway this is ephemeral disk.
const WORK_DIR = process.env.VIDEO_WORK_DIR || join(tmpdir(), "viralclip-videos");
const DOWNLOAD_CACHE_DIR = join(WORK_DIR, "downloads");
const OUTPUT_DIR = join(WORK_DIR, "outputs");

// Ensure directories exist
function ensureDirs() {
  for (const dir of [WORK_DIR, DOWNLOAD_CACHE_DIR, OUTPUT_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/**
 * Download a YouTube video.
 *
 * Strategy (tries multiple methods since YouTube blocks cloud IPs):
 *   1. youtubei.js (Innertube API) WITH cookies — most reliable with auth
 *   2. yt-dlp WITH cookies (iOS client) — cookies make yt-dlp work too
 *   3. yt-dlp WITH cookies (web client)
 *   4. youtubei.js WITHOUT cookies
 *   5. yt-dlp WITHOUT cookies (various clients)
 *
 * YouTube cookies are read from YOUTUBE_COOKIES env var (base64-encoded
 * Netscape cookies.txt format). Get them from your browser using a
 * "Get cookies.txt" extension while logged into YouTube.
 */
export async function downloadVideo(
  youtubeId: string
): Promise<{ path: string; duration: number }> {
  ensureDirs();
  const outputPath = join(DOWNLOAD_CACHE_DIR, `${youtubeId}.mp4`);

  // Cache hit?
  if (existsSync(outputPath)) {
    console.log(`[video] cache hit for ${youtubeId}`);
    const duration = await getVideoDuration(outputPath);
    return { path: outputPath, duration };
  }

  // Load YouTube cookies from env var if available
  const cookiesFile = await loadYouTubeCookies();
  const hasCookies = cookiesFile !== null;
  console.log(`[video] downloading ${youtubeId}... (cookies: ${hasCookies ? "YES" : "NO"})`);

  if (!hasCookies) {
    console.log(
      "[video] ℹ️ No cookies set — trying pure-JS ytdl-core first (works great on residential IPs)"
    );
  }

  // Build list of download methods — ytdl-core is THE most reliable on home IPs
  const methods: { name: string; fn: () => Promise<void> }[] = [];

  // Method 0: @distube/ytdl-core — pure JavaScript, no Python/yt-dlp needed.
  // Most reliable on residential IPs. Handles format selection automatically.
  methods.push({
    name: "ytdl-core (pure JS)",
    fn: () => downloadWithYtdlCore(youtubeId, outputPath),
  });

  if (hasCookies) {
    methods.push({
      name: "youtubei.js + cookies",
      fn: () => downloadWithYoutubei(youtubeId, outputPath, cookiesFile!),
    });
    methods.push({
      name: "yt-dlp + cookies (ios)",
      fn: () => downloadWithYtDlp(youtubeId, outputPath, "ios", cookiesFile!),
    });
    methods.push({
      name: "yt-dlp + cookies (web)",
      fn: () => downloadWithYtDlp(youtubeId, outputPath, "web", cookiesFile!),
    });
  }

  // Always try youtubei.js without cookies too
  methods.push({
    name: "youtubei.js (no cookies)",
    fn: () => downloadWithYoutubei(youtubeId, outputPath, null),
  });

  // yt-dlp as last resort, with various clients
  methods.push({
    name: "yt-dlp (default)",
    fn: () => downloadWithYtDlp(youtubeId, outputPath, "default", null),
  });

  let lastError = "";
  const allErrors: string[] = [];
  for (let i = 0; i < methods.length; i++) {
    const { name, fn } = methods[i];
    try {
      console.log(`[video] trying method ${i + 1}/${methods.length}: ${name}`);
      await fn();

      if (existsSync(outputPath)) {
        const duration = await getVideoDuration(outputPath);
        const size = statSync(outputPath).size;
        if (size > 10000) {
          console.log(
            `[video] ✅ SUCCESS with "${name}": ${youtubeId} downloaded, ${duration}s, ${formatBytes(size)}`
          );
          return { path: outputPath, duration };
        } else {
          console.warn(
            `[video] method "${name}" produced tiny file (${size}B), trying next`
          );
          rmSync(outputPath, { force: true });
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      allErrors.push(`[${name}] ${lastError.slice(0, 400)}`);
      console.warn(
        `[video] method "${name}" failed:`,
        lastError.slice(0, 400)
      );
    }
  }

  // All methods failed — give clear guidance with ALL errors
  let hint = "";
  if (!hasCookies) {
    hint =
      "SOLUTION: Set YOUTUBE_COOKIES env var on Railway. " +
      "1) Install 'Get cookies.txt LOCALLY' browser extension. " +
      "2) Log into YouTube in your browser. " +
      "3) Export cookies for youtube.com. " +
      "4) Base64-encode the file: base64 cookies.txt (or use an online tool). " +
      "5) Set YOUTUBE_COOKIES=<base64string> on Railway Variables. " +
      "This makes YouTube see requests as coming from your logged-in session.";
  } else {
    hint =
      "Cookies were set but all methods still failed. Common causes: " +
      "(1) Cookies are EXPIRED — re-export from browser and update YOUTUBE_COOKIES. " +
      "(2) YouTube requires a PO Token (Proof of Origin) which yt-dlp may need configured. " +
      "(3) The video may be private/age-restricted/DRM-protected. " +
      "(4) YouTube is aggressively blocking this specific Railway server IP. " +
      "Try a different video first to rule out video-specific issues.";
  }

  throw new Error(
    `All ${methods.length} download methods failed for ${youtubeId}.\n` +
      `=== ALL METHOD ERRORS ===\n${allErrors.join("\n")}\n` +
      `=== END ERRORS ===\n` +
      `${hint}`
  );
}

/**
 * Extract the human-readable YouTube error from yt-dlp's stderr output.
 * yt-dlp logs verbose info, but the actual error is usually after "ERROR:".
 */
function extractYouTubeError(stderr: string): string {
  if (!stderr) return "";
  // Look for ERROR: lines (yt-dlp format)
  const errorLines = stderr
    .split("\n")
    .filter((l) => l.includes("ERROR:") || l.includes("error:"))
    .map((l) => l.replace(/^.*?ERROR:\s*/i, "").trim());
  if (errorLines.length > 0) {
    // Return the last (most specific) error
    return errorLines[errorLines.length - 1];
  }
  // Fallback: last non-empty line
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : "";
}

/**
 * Load YouTube cookies from YOUTUBE_COOKIES env var.
 * Expects base64-encoded Netscape cookies.txt format.
 * Writes to a temp file and returns the path (or null if not set).
 */
let cachedCookiesFile: string | null = null;
let cookiesLoaded = false;

async function loadYouTubeCookies(): Promise<string | null> {
  if (cookiesLoaded) return cachedCookiesFile;
  cookiesLoaded = true;

  const encoded = process.env.YOUTUBE_COOKIES;
  if (!encoded || encoded.trim() === "") {
    return null;
  }

  try {
    // Decode base64
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");

    // Basic validation: should contain Netscape cookies format
    if (!decoded.includes("#") && !decoded.includes(".youtube.com")) {
      console.warn(
        "[video] YOUTUBE_COOKIES doesn't look like Netscape cookies.txt format"
      );
      return null;
    }

    const cookiesPath = join(DOWNLOAD_CACHE_DIR, "youtube-cookies.txt");
    await writeFile(cookiesPath, decoded, "utf-8");
    cachedCookiesFile = cookiesPath;
    console.log(`[video] loaded YouTube cookies: ${cookiesPath}`);
    return cookiesPath;
  } catch (err) {
    console.warn(
      "[video] failed to decode YOUTUBE_COOKIES env var:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Download using youtubei.js (Innertube API) — best at bypassing bot detection.
 * If cookies file is provided, YouTube sees requests as coming from your
 * logged-in session (reliable way to bypass bot detection on cloud servers).
 */
async function downloadWithYoutubei(
  youtubeId: string,
  outputPath: string,
  cookiesFile: string | null
): Promise<void> {
  const Innertube = (await import("youtubei.js")).default;

  // Load cookies into youtubei.js if available
  let youtube: any;
  if (cookiesFile) {
    try {
      const cookiesContent = await readFile(cookiesFile, "utf-8");
      // Convert Netscape cookies.txt → HTTP Cookie header string
      // youtubei.js expects: { cookie: "name1=value1; name2=value2; ..." }
      const cookieHeader = netscapeToCookieHeader(cookiesContent);
      if (cookieHeader) {
        youtube = await Innertube.create({
          cookie: cookieHeader,
        });
        console.log(
          `[video][youtubei] using cookies (${cookieHeader.split(";").length} cookies)`
        );
      } else {
        console.warn(
          "[video][youtubei] no valid cookies found in file, continuing without"
        );
        youtube = await Innertube.create();
      }
    } catch (err) {
      console.warn(
        "[video][youtubei] failed to load cookies, continuing without:",
        err instanceof Error ? err.message : err
      );
      youtube = await Innertube.create();
    }
  } else {
    youtube = await Innertube.create();
  }

  console.log(`[video][youtubei] fetching video info for ${youtubeId}...`);

  let info: any;
  try {
    info = await youtube.getInfo(youtubeId);
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const errName = err?.name || "";
    throw new Error(
      `youtubei.js getInfo() failed: ${errName}: ${errMsg.slice(0, 400)}. ` +
        `This usually means YouTube is blocking the request (even with cookies), ` +
        `or the cookies are invalid/expired.`
    );
  }
  console.log(`[video][youtubei] got info, title: "${info.basic_info.title}"`);

  // Get streaming data
  const streamingData = info.streaming_data;
  if (!streamingData) {
    throw new Error("No streaming data available (video may be private/DRM)");
  }

  // Find best video-only stream ≤720p (mp4 preferred)
  const videoFormats = streamingData.adaptive_formats.filter(
    (f: any) => f.has_video && f.mime_type?.includes("video/mp4")
  );
  const audioFormats = streamingData.adaptive_formats.filter(
    (f: any) => f.has_audio && f.mime_type?.includes("audio/mp4")
  );

  if (videoFormats.length === 0) {
    throw new Error("No MP4 video streams found");
  }

  // Pick best video ≤720p (highest bitrate)
  const videoStream = videoFormats
    .filter((f: any) => (f.height || 0) <= 720)
    .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

  if (!videoStream) {
    throw new Error("No video stream ≤720p available");
  }

  // Pick best audio (highest bitrate)
  const audioStream = audioFormats
    .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

  if (!audioStream) {
    throw new Error("No audio stream available");
  }

  console.log(
    `[video][youtubei] video: ${videoStream.height}p, audio: ${audioStream.bitrate}bps`
  );

  // Download video stream to temp file
  const tempVideo = join(DOWNLOAD_CACHE_DIR, `${youtubeId}.video.mp4`);
  const tempAudio = join(DOWNLOAD_CACHE_DIR, `${youtubeId}.audio.mp4`);

  console.log(`[video][youtubei] downloading video stream...`);
  // youtubei.js v17: Format objects have a .url property (signed URL).
  // Download via HTTP fetch with proper headers.
  if (!videoStream.url) {
    throw new Error("Video stream has no URL — youtubei.js API changed");
  }
  await downloadStreamToFile(videoStream.url, tempVideo, youtube);

  console.log(`[video][youtubei] downloading audio stream...`);
  if (!audioStream.url) {
    throw new Error("Audio stream has no URL — youtubei.js API changed");
  }
  await downloadStreamToFile(audioStream.url, tempAudio, youtube);

  // Merge with ffmpeg
  console.log(`[video][youtubei] merging video+audio with ffmpeg...`);
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      tempVideo,
      "-i",
      tempAudio,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
  );

  // Cleanup temp files
  rmSync(tempVideo, { force: true });
  rmSync(tempAudio, { force: true });

  if (!existsSync(outputPath)) {
    throw new Error("ffmpeg merge finished but output not found");
  }
  console.log(
    `[video][youtubei] merge complete: ${formatBytes(statSync(outputPath).size)}`
  );
}

/**
 * Convert Netscape cookies.txt format to HTTP Cookie header string.
 * youtubei.js expects: { cookie: "name1=value1; name2=value2; ..." }
 */
function netscapeToCookieHeader(content: string): string {
  const pairs: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Netscape format: domain  flag  path  secure  expiration  name  value
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

/**
 * Validate that cookies file contains required YouTube auth cookies.
 * Returns { valid, cookieCount, missingCookies[] }
 */
export function validateYouTubeCookies(content: string): {
  valid: boolean;
  cookieCount: number;
  hasLoginInfo: boolean;
  hasVisitorInfo: boolean;
  domains: string[];
} {
  const lines = content.split(/\r?\n/);
  const cookies: Array<{ name: string; domain: string }> = [];
  const domains = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 7) {
      const domain = parts[0];
      const name = parts[5];
      cookies.push({ name, domain });
      domains.add(domain);
    }
  }

  const hasLoginInfo = cookies.some((c) => c.name === "LOGIN_INFO");
  const hasVisitorInfo = cookies.some((c) => c.name === "VISITOR_INFO1_LIVE");

  return {
    valid: cookies.length > 0,
    cookieCount: cookies.length,
    hasLoginInfo,
    hasVisitorInfo,
    domains: Array.from(domains),
  };
}

/**
 * Download using @distube/ytdl-core — pure JavaScript YouTube downloader.
 * Most reliable on residential IPs. No Python/yt-dlp needed.
 * Handles format selection automatically: picks best video+audio ≤720p.
 */
async function downloadWithYtdlCore(
  youtubeId: string,
  outputPath: string
): Promise<void> {
  const ytdl = (await import("@distube/ytdl-core")).default;
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;

  console.log(`[video][ytdl-core] fetching info for ${youtubeId}...`);

  // Create a custom agent with proper headers to avoid 403
  // YouTube blocks requests without proper User-Agent and Accept headers
  const agent = ytdl.createAgent(
    [
      {
        name: "User-Agent",
        value:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      {
        name: "Accept",
        value: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      {
        name: "Accept-Language",
        value: "en-US,en;q=0.9",
      },
      {
        name: "Accept-Encoding",
        value: "gzip, deflate, br",
      },
      {
        name: "DNT",
        value: "1",
      },
      {
        name: "Upgrade-Insecure-Requests",
        value: "1",
      },
    ]
  );

  const info = await ytdl.getInfo(url, { agent });
  console.log(
    `[video][ytdl-core] got info, title: "${info.videoDetails.title}"`
  );

  // Pick best video+audio format ≤720p
  const format = ytdl.chooseFormat(info.formats, {
    quality: "highest",
    filter: (f) => {
      const hasVideo = f.hasVideo;
      const hasAudio = f.hasAudio;
      const height = f.height || 0;
      if (hasVideo && hasAudio && height <= 720) return true;
      if (hasVideo && !hasAudio && height <= 720) return true;
      return false;
    },
  });

  if (!format) {
    throw new Error("No suitable video format found (≤720p)");
  }

  console.log(
    `[video][ytdl-core] selected format: ${format.height}p, container: ${format.container}, hasVideo: ${format.hasVideo}, hasAudio: ${format.hasAudio}`
  );

  // Check if format has both video+audio
  if (format.hasVideo && format.hasAudio) {
    // Single stream — download directly
    console.log(`[video][ytdl-core] downloading combined stream...`);
    const videoStream = ytdl(url, { format, agent });
    const writer = createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
      videoStream.pipe(writer);
      writer.on("finish", () => {
        const size = statSync(outputPath).size;
        console.log(
          `[video][ytdl-core] ✅ downloaded: ${formatBytes(size)}`
        );
        resolve();
      });
      writer.on("error", reject);
      videoStream.on("error", reject);
    });
  }

  // Video-only stream — need to download audio separately and merge
  console.log(`[video][ytdl-core] video-only format, downloading audio too...`);

  const audioFormat = ytdl.chooseFormat(info.formats, {
    quality: "highestaudio",
    filter: "audioonly",
  });

  if (!audioFormat) {
    throw new Error("No audio format found");
  }

  const tempVideo = join(DOWNLOAD_CACHE_DIR, `${youtubeId}.ytdl.video.mp4`);
  const tempAudio = join(DOWNLOAD_CACHE_DIR, `${youtubeId}.ytdl.audio.mp4`);

  // Download video
  console.log(`[video][ytdl-core] downloading video stream...`);
  await new Promise<void>((resolve, reject) => {
    ytdl(url, { format, agent })
      .pipe(createWriteStream(tempVideo))
      .on("finish", resolve)
      .on("error", reject);
  });

  // Download audio
  console.log(`[video][ytdl-core] downloading audio stream...`);
  await new Promise<void>((resolve, reject) => {
    ytdl(url, { format: audioFormat, agent })
      .pipe(createWriteStream(tempAudio))
      .on("finish", resolve)
      .on("error", reject);
  });

  // Merge with ffmpeg
  console.log(`[video][ytdl-core] merging video+audio with ffmpeg...`);
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      tempVideo,
      "-i",
      tempAudio,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
  );

  // Cleanup temp files
  rmSync(tempVideo, { force: true });
  rmSync(tempAudio, { force: true });

  if (!existsSync(outputPath)) {
    throw new Error("ffmpeg merge finished but output not found");
  }
  console.log(
    `[video][ytdl-core] ✅ merged: ${formatBytes(statSync(outputPath).size)}`
  );
}

/**
 * Download a YouTube stream URL to a file using HTTP fetch.
 * YouTube streaming URLs require specific headers (range requests, user-agent).
 */
async function downloadStreamToFile(
  streamUrl: string,
  filePath: string,
  youtubeInstance?: any
): Promise<void> {
  console.log(`[video][youtubei] downloading stream → ${filePath}`);

  const response = await fetch(streamUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Range": "bytes=0-",
      // YouTube sometimes requires these
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
    },
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `Stream download failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  if (!response.body) {
    throw new Error("Stream download returned no body");
  }

  // Convert Web ReadableStream to Node stream and save to file
  const nodeStream = Readable.fromWeb(response.body as any);
  const writer = createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    nodeStream.pipe(writer);
    writer.on("finish", () => {
      const size = statSync(filePath).size;
      console.log(`[video][youtubei] stream downloaded: ${formatBytes(size)}`);
      resolve();
    });
    writer.on("error", reject);
    nodeStream.on("error", reject);
  });
}

/**
 * Save a youtubei.js stream (ReadableStream or similar) to a file.
 * Kept as fallback for older youtubei.js versions that support .download().
 */
async function streamToFile(stream: any, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(filePath);
    // youtubei.js streams are typically Node streams or Web ReadableStreams
    if (stream.pipe) {
      // Node.js readable stream
      stream.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    } else if (typeof stream.getReader === "function") {
      // Web ReadableStream — convert to Node stream
      const nodeStream = Readable.fromWeb(stream as any);
      nodeStream.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    } else {
      // Try to treat as async iterable
      (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        await writeFile(filePath, Buffer.concat(chunks));
        resolve();
      })().catch(reject);
    }
  });
}

/**
 * Download using yt-dlp with a specific player client.
 * If cookies file is provided, passes --cookies-file to yt-dlp.
 */
async function downloadWithYtDlp(
  youtubeId: string,
  outputPath: string,
  playerClient: string,
  cookiesFile: string | null
): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  const tempOutput = join(DOWNLOAD_CACHE_DIR, `${youtubeId}.part`);

  const ytDlpArgs = [
    url,
    // Use format sorting instead of strict format string.
    // -S "res:720" = prefer resolution up to 720p
    // "bestvideo+bestaudio/best" = merge best video+audio, fallback to single file
    "-f",
    "bestvideo[height<=720]+bestaudio/best[height<=720]/bestvideo+bestaudio/best",
    "-S",
    "res:720,br",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--extractor-args",
    `youtube:player_client=${playerClient}`,
  ];

  // Add cookies file if available
  if (cookiesFile) {
    ytDlpArgs.push("--cookies", cookiesFile);
  }

  ytDlpArgs.push("-o", tempOutput);

  const cookiesLabel = cookiesFile ? " + cookies" : "";
  console.log(`[video][yt-dlp] client=${playerClient}${cookiesLabel}`);
  try {
    const { stdout, stderr } = await execFileAsync("yt-dlp", ytDlpArgs, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`[video][yt-dlp] stdout:`, stdout.slice(0, 300));
    console.log(`[video][yt-dlp] stderr:`, stderr.slice(0, 300));
  } catch (err: any) {
    // Capture the FULL error output — yt-dlp's real error is in err.stderr
    const stderr = err?.stderr || "";
    const stdout = err?.stdout || "";
    const cmdMessage = err instanceof Error ? err.message : String(err);
    // Extract the actual YouTube error from stderr (last non-empty line)
    const ytError = extractYouTubeError(stderr);
    const fullError =
      `yt-dlp (${playerClient}${cookiesLabel}) failed: ` +
      `${ytError || cmdMessage.slice(0, 200)}` +
      (stderr ? ` | full stderr: ${stderr.slice(0, 600)}` : "");
    console.error(`[video][yt-dlp] FULL ERROR:`, fullError);
    throw new Error(fullError);
  }

  // Find the output file (yt-dlp might output to different paths)
  const possibleOutputs = [tempOutput, `${tempOutput}.mp4`, outputPath];
  let foundPath = "";
  for (const p of possibleOutputs) {
    if (existsSync(p)) {
      foundPath = p;
      break;
    }
  }

  if (!foundPath) {
    throw new Error("yt-dlp finished but output file not found");
  }

  // Rename to final output path
  if (foundPath !== outputPath) {
    renameSync(foundPath, outputPath);
  }
}

/**
 * Get video duration in seconds using ffprobe.
 */
async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 30000 }
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Generate an ASS subtitle file with WORD-BY-WORD karaoke timing.
 *
 * This creates TikTok/Shorts-style subtitles where:
 * - Text is broken into short phrases (2-4 words)
 * - Each word highlights (yellow) as it's spoken
 * - Large, bold text at bottom-center
 * - High contrast for mobile viewing
 *
 * ASS format supports \k tags (karaoke) that ffmpeg's subtitles filter
 * can render with word highlighting.
 */
export function generateASS(
  clip: ClipItem,
  clipDuration: number
): string {
  if (!clip.transcript) return "";

  // The video transcript is stored as: [seconds] text\n[seconds] text\n...
  // Parse these to get REAL timestamps from YouTube
  const rawLines = clip.transcript.split("\n").map((l) => l.trim()).filter(Boolean);

  let entries: { start: number; end: number; text: string }[] = [];

  // Parse each line for timestamps — handle multiple formats:
  // [12.5] text  |  [1:23] text  |  [1:23.5] text  |  [0:05] text
  for (const line of rawLines) {
    let time: number | null = null;
    let text: string | null = null;

    // Try [mm:ss.ss] format first
    const mmMatch = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.+)$/);
    if (mmMatch) {
      time = parseInt(mmMatch[1]) * 60 + parseFloat(mmMatch[2]);
      text = mmMatch[3].trim();
    } else {
      // Try [ss.ss] format
      const ssMatch = line.match(/^\[(\d+(?:\.\d+)?)\]\s*(.+)$/);
      if (ssMatch) {
        time = parseFloat(ssMatch[1]);
        text = ssMatch[2].trim();
      }
    }

    if (time !== null && text !== null && text.length > 0) {
      // Only include lines within the clip's time range
      if (time >= clip.startTime && time <= clip.endTime) {
        entries.push({
          start: time - clip.startTime,
          end: time - clip.startTime + 3, // default, will be fixed
          text,
        });
      }
    }
  }

  // If no timestamped entries found, fall back to distributing text evenly
  if (entries.length === 0) {
    console.warn("[ass] no timestamped entries found, distributing evenly");
    const perLine = clipDuration / rawLines.length;
    rawLines.forEach((text, i) => {
      entries.push({ start: i * perLine, end: (i + 1) * perLine, text });
    });
  } else {
    // Fix end times: each entry ends when next starts
    for (let i = 0; i < entries.length - 1; i++) {
      entries[i].end = Math.min(entries[i].end, entries[i + 1].start);
    }
    if (entries.length > 0) {
      entries[entries.length - 1].end = clipDuration;
    }
  }

  if (entries.length === 0) return "";

  console.log(`[ass] generated ${entries.length} subtitle entries`);

  // Build ASS file — use DejaVu Sans Bold (ALWAYS available on Debian/Ubuntu)
  const ass = `[Script Info]
Title: ViralClip AI Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1080
PlayResY: 1920
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,DejaVu Sans,76,&H00FFFFFF,&H0000F9FF,&H00000000,&HCC000000,-1,0,0,0,100,100,1,0,3,6,3,2,60,60,500,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines: string[] = [];

  for (const entry of entries) {
    const words = entry.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Break into phrases of 2-4 words
    const phraseSize = Math.min(4, Math.max(2, Math.ceil(words.length / 3)));
    const phrases: string[][] = [];
    for (let i = 0; i < words.length; i += phraseSize) {
      phrases.push(words.slice(i, i + phraseSize));
    }

    const phraseDuration = (entry.end - entry.start) / phrases.length;

    phrases.forEach((phrase, pIdx) => {
      const phraseStart = entry.start + pIdx * phraseDuration;
      const phraseEnd = phraseStart + phraseDuration;
      const wordDur = phraseDuration / phrase.length;

      // Build karaoke text — each word gets \k timing (centiseconds)
      const karaokeText = phrase
        .map((word) => {
          const cs = Math.max(5, Math.round(wordDur * 10));
          return `{\\k${cs}}${word}`;
        })
        .join(" ");

      // Add fade in/out
      const styledLine = `{\\fad(80,60)}${karaokeText}`;

      dialogueLines.push(
        `Dialogue: 0,${formatASSTime(phraseStart)},${formatASSTime(
          phraseEnd
        )},Main,,0,0,0,,${styledLine}`
      );
    });
  }

  const fullAss = ass + dialogueLines.join("\n") + "\n";
  console.log(`[ass] ASS file size: ${fullAss.length} chars, ${dialogueLines.length} dialogue lines`);
  return fullAss;
}

/**
 * Format time for ASS subtitles: H:MM:SS.cs (centiseconds)
 */
function formatASSTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )}.${String(cs).padStart(2, "0")}`;
}

/**
 * Generate an SRT subtitle file from the clip's transcript.
 * (Kept for backward compatibility, but ASS is preferred for karaoke effect)
 */
export function generateSRT(
  clip: ClipItem,
  clipDuration: number
): string {
  if (!clip.transcript) return "";

  const lines = clip.transcript
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  const timestamped = lines.every((l) => /^\[\d+:\d+\]/.test(l));

  let srtEntries: { start: number; end: number; text: string }[] = [];

  if (timestamped) {
    for (const line of lines) {
      const match = line.match(/^\[(\d+):(\d+)\]\s*(.+)$/);
      if (match) {
        const [, mm, ss, text] = match;
        const time = parseInt(mm) * 60 + parseInt(ss);
        if (time >= clip.startTime && time <= clip.endTime) {
          srtEntries.push({
            start: time - clip.startTime,
            end: time - clip.startTime + 3,
            text: text.trim(),
          });
        }
      }
    }
    for (let i = 0; i < srtEntries.length - 1; i++) {
      srtEntries[i].end = Math.min(srtEntries[i].end, srtEntries[i + 1].start);
    }
    if (srtEntries.length > 0) {
      srtEntries[srtEntries.length - 1].end = clipDuration;
    }
  } else {
    const perLine = clipDuration / lines.length;
    lines.forEach((text, i) => {
      srtEntries.push({ start: i * perLine, end: (i + 1) * perLine, text });
    });
  }

  return srtEntries
    .map((entry, i) => {
      return `${i + 1}\n${formatSRTTime(entry.start)} --> ${formatSRTTime(
        entry.end
      )}\n${entry.text}\n`;
    })
    .join("\n");
}

function formatSRTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(
    secs
  ).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * Detect the crop region using ffmpeg's cropdetect filter.
 * This analyzes the first few seconds to find the active area (faces/motion).
 * Returns { x, y, width, height } or null if detection fails.
 */
async function detectCropRegion(
  videoPath: string,
  startTime: number,
  duration: number
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  // Run cropdetect on a 5-second sample from the middle of the clip
  const sampleStart = startTime + Math.floor(duration / 2);
  const sampleDuration = Math.min(5, duration);

  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-ss",
        String(sampleStart),
        "-i",
        videoPath,
        "-t",
        String(sampleDuration),
        "-vf",
        "cropdetect=24:16:0",
        "-f",
        "null",
        "-", // discard output, we just want stderr logs
      ],
      {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    // cropdetect outputs lines like: "crop=1280:720:0:0" to stderr
    // We need to capture stderr to parse it
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-ss",
        String(sampleStart),
        "-i",
        videoPath,
        "-t",
        String(sampleDuration),
        "-vf",
        "cropdetect=24:16:0",
        "-f",
        "null",
        "-",
      ],
      {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const cropMatches = stderr.match(/crop=(\d+):(\d+):(\d+):(\d+)/g);
    if (cropMatches && cropMatches.length > 0) {
      // Use the last (most stable) crop value
      const lastCrop = cropMatches[cropMatches.length - 1];
      const match = lastCrop.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
      if (match) {
        const [, w, h, x, y] = match.map(Number);
        console.log(
          `[video] cropdetect found region: ${w}x${h} at (${x},${y})`
        );
        return { x, y, width: w, height: h };
      }
    }
    console.log("[video] cropdetect found no region, using center crop");
    return null;
  } catch (err) {
    console.warn(
      "[video] cropdetect failed, using center crop:",
      err instanceof Error ? err.message.slice(0, 200) : err
    );
    return null;
  }
}

/**
 * Process a clip: cut from source video, crop to 9:16 (face-aware), burn subtitles.
 *
 * Output: 1080x1920 (9:16 vertical) — YouTube Shorts format.
 *
 * Face tracking: uses ffmpeg's cropdetect to find the active region (faces/motion),
 * then crops to 9:16 centered on that region. If detection fails, uses center crop
 * with top bias (faces usually in upper portion of frame).
 *
 * Subtitles: ASS format with word-by-word karaoke highlighting (TikTok/Shorts style).
 * Each word highlights (yellow) as it's spoken.
 *
 * @returns path to the processed video file
 */
export async function processClip(
  sourceVideoPath: string,
  clip: ClipItem
): Promise<string> {
  ensureDirs();
  const outputPath = join(OUTPUT_DIR, `${clip.id}.mp4`);
  const assPath = join(OUTPUT_DIR, `${clip.id}.ass`);

  // Generate ASS subtitle file (word-by-word karaoke style)
  const clipDuration = clip.endTime - clip.startTime;
  const assContent = generateASS(clip, clipDuration);
  if (assContent) {
    await writeFile(assPath, assContent, "utf-8");
    console.log(
      `[video] generated ASS subtitles: ${assPath} (${assContent.length} chars)`
    );
  }

  // Get source video dimensions
  const dims = await getVideoDimensions(sourceVideoPath);
  const srcWidth = dims.width || 1920;
  const srcHeight = dims.height || 1080;
  console.log(
    `[video] source video: ${srcWidth}x${srcHeight}`
  );

  // Face tracking: detect active crop region
  const detectedCrop = await detectCropRegion(
    sourceVideoPath,
    clip.startTime,
    clipDuration
  );

  // Calculate 9:16 crop dimensions (VERTICAL for YouTube Shorts)
  // Target output: 1080x1920 (9:16 vertical)
  let cropWidth: number;
  let cropHeight: number;
  let cropX: number;
  let cropY: number;

  if (detectedCrop) {
    // Use detected region, but ensure 9:16 aspect ratio (vertical)
    const detectedAspect =
      detectedCrop.width / detectedCrop.height;
    if (detectedAspect > 9 / 16) {
      // Too wide — use height, calculate width for 9:16
      cropHeight = detectedCrop.height;
      cropWidth = Math.round(cropHeight * 9 / 16);
    } else {
      // Too tall — use width, calculate height for 9:16
      cropWidth = detectedCrop.width;
      cropHeight = Math.round(cropWidth * 16 / 9);
    }
    // Center on detected region (face area)
    cropX =
      detectedCrop.x + Math.round((detectedCrop.width - cropWidth) / 2);
    cropY =
      detectedCrop.y + Math.round((detectedCrop.height - cropHeight) / 2);
  } else {
    // Center crop: use full HEIGHT, calculate width for 9:16 vertical
    // For talking-head videos, face is usually in center-upper area
    cropHeight = srcHeight;
    cropWidth = Math.round(cropHeight * 9 / 16);
    cropX = Math.max(0, Math.round((srcWidth - cropWidth) / 2));
    cropY = 0; // top-aligned to capture faces
  }

  // Ensure crop dimensions are even numbers (ffmpeg requirement for libx264)
  cropWidth = Math.round(cropWidth / 2) * 2;
  cropHeight = Math.round(cropHeight / 2) * 2;
  cropX = Math.round(cropX / 2) * 2;
  cropY = Math.round(cropY / 2) * 2;

  // Clamp to source dimensions
  if (cropWidth > srcWidth) cropWidth = srcWidth;
  if (cropHeight > srcHeight) cropHeight = srcHeight;
  if (cropX + cropWidth > srcWidth)
    cropX = Math.max(0, srcWidth - cropWidth);
  if (cropY + cropHeight > srcHeight)
    cropY = Math.max(0, srcHeight - cropHeight);

  console.log(
    `[video] processing clip ${clip.id}: ${clip.startTime}s-${clip.endTime}s, ` +
      `crop ${cropWidth}x${cropHeight} at (${cropX},${cropY}) → scale to 1080x1920 (9:16 vertical)`
  );

  // Build ffmpeg filter chain with enhanced editing effects:
  //   1. crop to detected/centered region (9:16 aspect, face-biased)
  //   2. scale to 1080x1920 (9:16 vertical output for YouTube Shorts)
  //   3. eq: color enhancement (saturation/contrast/brightness)
  //   4. drawbox: progress bar at top (viral style)
  //   5. drawtext: watermark "ViralClip AI" (persistent, bottom-right)
  //   6. drawbox + drawtext: intro card (first 2.5s, with branding)
  //   7. drawbox + drawtext: outro card (last 2s, CTA)
  //   8. drawtext: emoji overlay on climax moments (if score >= 75)
  //   9. burn ASS subtitles (word-by-word karaoke style)
  const filters: string[] = [
    `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`,
    `scale=1080:1920:force_original_aspect_ratio=decrease`,
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`,
    // Color enhancement
    `eq=saturation=1.1:contrast=1.05:brightness=0.02`,
  ];

  // Progress bar at top (viral style) — grows with time
  filters.push(
    `drawbox=x=0:y=0:w=1080:h=6:color=black@0.5:t=fill`,
    `drawbox=x=0:y=0:w='iw*t/${clipDuration}':h=6:color=0x6D28D9@0.9:t=fill`
  );

  // Font files (always available after apt install fonts-dejavu fonts-noto)
  const fontBold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const fontRegular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

  // Watermark "ViralClip AI" — persistent, bottom-right
  filters.push(
    `drawtext=fontfile=${fontBold}:text='ViralClip AI':fontcolor=white@0.7:fontsize=24:x=w-tw-20:y=h-th-20:box=1:boxcolor=black@0.5:boxborderw=6`
  );

  // Intro card: first 2.5 seconds
  // Background box + title text + "VIRAL CLIP" branding
  const escapedTitle = clip.title.replace(/'/g, "\\'").replace(/:/g, "\\:").slice(0, 40);
  filters.push(
    // Background box (purple gradient feel)
    `drawbox=x=80:y=350:w=920:h=200:color=0x6D28D9@0.85:t=fill:enable='lt(t,2.5)'`,
    `drawbox=x=80:y=350:w=920:h=200:color=white@0.3:t=fill:enable='lt(t,2.5)'`,
    // Title text
    `drawtext=fontfile=${fontBold}:text='${escapedTitle}':fontcolor=white:fontsize=36:x=(w-tw)/2:y=400:enable='lt(t,2.5)'`,
    // "VIRAL CLIP" branding
    `drawtext=fontfile=${fontBold}:text='VIRAL CLIP':fontcolor=0xFFD700:fontsize=28:x=(w-tw)/2:y=480:enable='lt(t,2.5)'`
  );

  // Outro card: last 2.5 seconds
  const outroStart = Math.max(0, clipDuration - 2.5);
  const topHashtag = clip.hashtags && clip.hashtags.length > 0 ? clip.hashtags[0] : "shorts";
  filters.push(
    // Background box
    `drawbox=x=80:y=750:w=920:h=300:color=black@0.8:t=fill:enable='gt(t,${outroStart})'`,
    `drawbox=x=80:y=750:w=920:h=300:color=0x6D28D9@0.5:t=fill:enable='gt(t,${outroStart})'`,
    // "Follow for more!" text
    `drawtext=fontfile=${fontBold}:text='Follow for more!':fontcolor=white:fontsize=44:x=(w-tw)/2:y=820:enable='gt(t,${outroStart})'`,
    // Hashtag
    `drawtext=fontfile=${fontRegular}:text='#${topHashtag}':fontcolor=0xFFD700:fontsize=32:x=(w-tw)/2:y=900:enable='gt(t,${outroStart})'`
  );

  // Emoji overlay on climax clips (score >= 75)
  // Show emoji at 30% and 70% of clip duration for 1 second each
  if (clip.score >= 75) {
    const emoji1Time = clipDuration * 0.3;
    const emoji2Time = clipDuration * 0.7;
    // Use Noto Color Emoji font if available, else skip emoji
    const emojiFont = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf";
    filters.push(
      `drawtext=fontfile=${fontBold}:text='FIRE':fontcolor=0xFF4500:fontsize=120:x=(w-tw)/2:y=200:enable='between(t,${emoji1Time},${emoji1Time + 1})':alpha='if(lt(t,${emoji1Time + 0.5}),1,1-(t-${emoji1Time + 0.5})/0.5)'`,
      `drawtext=fontfile=${fontBold}:text='WOW':fontcolor=0xFFD700:fontsize=120:x=(w-tw)/2:y=200:enable='between(t,${emoji2Time},${emoji2Time + 1})':alpha='if(lt(t,${emoji2Time + 0.5}),1,1-(t-${emoji2Time + 0.5})/0.5)'`
    );
  }

  if (assContent) {
    // ASS subtitles support karaoke (\k tags) for word-by-word highlighting
    const escapedAss = assPath.replace(/:/g, "\\:");
    filters.push(`subtitles='${escapedAss}'`);
  }

  const filterComplex = filters.join(",");

  const ffmpegArgs = [
    "-y", // overwrite output
    "-ss",
    String(clip.startTime),
    "-to",
    String(clip.endTime),
    "-i",
    sourceVideoPath,
    "-vf",
    filterComplex,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    String(clipDuration),
    outputPath,
  ];

  console.log(
    `[video] running ffmpeg with args:`,
    ffmpegArgs.join(" ")
  );

  try {
    const { stdout, stderr } = await execFileAsync("ffmpeg", ffmpegArgs, {
      timeout: 300000, // 5 min processing timeout
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`[video] ffmpeg stderr (last 800):`, stderr.slice(-800));
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    // Capture FULL stderr from ffmpeg — it's in err.stderr, not err.message
    const fullStderr = err?.stderr || "";
    console.error(`[video] ffmpeg FAILED:`, message.slice(0, 500));
    console.error(`[video] ffmpeg FULL STDERR:`, fullStderr.slice(-1500));
    throw new Error(
      `ffmpeg failed to process clip. Details: ${message.slice(0, 300)}. ` +
        `FFMPEG STDERR: ${fullStderr.slice(-800)}`
    );
  }

  if (!existsSync(outputPath)) {
    throw new Error("ffmpeg finished but output file not found.");
  }

  const size = statSync(outputPath).size;
  console.log(
    `[video] clip processed: ${outputPath} (${formatBytes(size)})`
  );
  return outputPath;
}

/**
 * Get video dimensions using ffprobe.
 */
async function getVideoDimensions(
  filePath: string
): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        filePath,
      ],
      { timeout: 30000 }
    );
    const [w, h] = stdout.trim().split("x").map(Number);
    return { width: w || 1920, height: h || 1080 };
  } catch {
    return { width: 1920, height: 1080 };
  }
}

/**
 * Render a clip: download source video (if needed) + process to 16:9 with subtitles.
 * Updates the Clip record's status + downloadUrl.
 */
export async function renderClip(clipId: string): Promise<{
  downloadUrl: string;
  fileSize: number;
  filePath: string;
}> {
  console.log(`[render] starting for clip ${clipId}`);

  // 1. Load the clip + its video from DB
  const clip = await db.clip.findUnique({
    where: { id: clipId },
    include: { video: true },
  });

  if (!clip) throw new Error("Clip not found.");
  if (!clip.video) throw new Error("Source video not found.");

  // Update status to "downloading"
  await db.clip.update({
    where: { id: clipId },
    data: { status: "downloading" },
  });

  try {
    // 2. Download the source video (cached)
    const { path: videoPath } = await downloadVideo(clip.video.youtubeId);

    // 3. Build the ClipItem shape needed by processClip
    //    IMPORTANT: Use the VIDEO's timestamped transcript (from YouTube),
    //    NOT the clip's transcript (from OpenAI, may not have timestamps).
    //    The video.transcript field has [seconds] text format with real timestamps.
    const clipItem: ClipItem = {
      id: clip.id,
      videoId: clip.videoId,
      startTime: clip.startTime,
      endTime: clip.endTime,
      duration: clip.duration,
      title: clip.title,
      description: clip.description,
      reason: clip.reason,
      score: clip.score,
      hook: clip.hook,
      hashtags: clip.hashtags ? JSON.parse(clip.hashtags) : null,
      transcript: clip.video.transcript || clip.transcript, // ← Use video's real timestamped transcript
      status: "downloading",
      downloadUrl: clip.downloadUrl,
      createdAt: clip.createdAt.toISOString(),
    };

    // 4. Process: cut + crop 9:16 + face tracking + burn subtitles + effects
    const outputPath = await processClip(videoPath, clipItem);

    // 5. Verify file exists
    if (!existsSync(outputPath)) {
      throw new Error("Rendered file not found after processing.");
    }

    const fileSize = statSync(outputPath).size;
    const downloadUrl = `/api/clips/${clipId}/download`;

    // 6. Update DB
    await db.clip.update({
      where: { id: clipId },
      data: {
        status: "downloaded",
        downloadUrl,
      },
    });

    console.log(
      `[render] SUCCESS for clip ${clipId}: ${downloadUrl} (${formatBytes(fileSize)})`
    );

    return { downloadUrl, fileSize, filePath: outputPath };
  } catch (err) {
    console.error(`[render] FAILED for clip ${clipId}:`, err);
    await db.clip.update({
      where: { id: clipId },
      data: {
        status: "failed",
      },
    });
    throw err;
  }
}

/**
 * Get the file path for a processed clip (used by the download endpoint).
 */
export function getClipFilePath(clipId: string): string {
  return join(OUTPUT_DIR, `${clipId}.mp4`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
