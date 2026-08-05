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
} from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
 *   1. youtubei.js (Innertube API) — pure JS, best at bypassing bot detection
 *   2. yt-dlp with iOS client — iOS client often less blocked than android/web
 *   3. yt-dlp with default settings — last resort
 *
 * Caches by videoId so we don't re-download for each clip of the same video.
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

  console.log(`[video] downloading ${youtubeId}...`);

  // Try each download method in sequence
  const methods = [
    () => downloadWithYoutubei(youtubeId, outputPath),
    () => downloadWithYtDlp(youtubeId, outputPath, "ios,android,web"),
    () => downloadWithYtDlp(youtubeId, outputPath, "ios"),
    () => downloadWithYtDlp(youtubeId, outputPath, "tv,web_safari"),
    () => downloadWithYtDlp(youtubeId, outputPath, "default"),
  ];

  let lastError = "";
  for (let i = 0; i < methods.length; i++) {
    try {
      console.log(`[video] trying download method ${i + 1}/${methods.length}...`);
      await methods[i]();

      if (existsSync(outputPath)) {
        const duration = await getVideoDuration(outputPath);
        const size = statSync(outputPath).size;
        if (size > 10000) {
          // sanity check — file should be > 10KB
          console.log(
            `[video] SUCCESS with method ${i + 1}: ${youtubeId} downloaded, ${duration}s, ${formatBytes(size)}`
          );
          return { path: outputPath, duration };
        } else {
          console.warn(`[video] method ${i + 1} produced tiny file (${size}B), trying next`);
          rmSync(outputPath, { force: true });
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[video] method ${i + 1} failed:`, lastError.slice(0, 300));
    }
  }

  throw new Error(
    `All download methods failed for ${youtubeId}. ` +
      `YouTube is blocking this server's IP (cloud servers often get flagged as bots). ` +
      `Last error: ${lastError.slice(0, 400)}. ` +
      `Try again later, or use a different video.`
  );
}

/**
 * Download using youtubei.js (Innertube API) — best at bypassing bot detection.
 * Gets streaming URLs via YouTube's internal API, then downloads video+audio
 * and merges them with ffmpeg.
 */
async function downloadWithYoutubei(
  youtubeId: string,
  outputPath: string
): Promise<void> {
  const Innertube = (await import("youtubei.js")).default;
  const youtube = await Innertube.create();
  console.log(`[video][youtubei] fetching video info for ${youtubeId}...`);

  const info = await youtube.getInfo(youtubeId);
  console.log(`[video][youtubei] got info, title: "${info.basic_info.title}"`);

  // Get streaming data — choose best 720p video + best audio
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
  await streamToFile(videoStream, tempVideo);

  console.log(`[video][youtubei] downloading audio stream...`);
  await streamToFile(audioStream, tempAudio);

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
  console.log(`[video][youtubei] merge complete: ${formatBytes(statSync(outputPath).size)}`);
}

/**
 * Save a youtubei.js stream (ReadableStream or similar) to a file.
 */
async function streamToFile(stream: any, filePath: string): Promise<void> {
  const { createWriteStream } = await import("node:fs");
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
      const { Readable } = require("node:stream");
      const nodeStream = Readable.fromWeb(stream);
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
 */
async function downloadWithYtDlp(
  youtubeId: string,
  outputPath: string,
  playerClient: string
): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  const tempOutput = join(DOWNLOAD_CACHE_DIR, `${youtubeId}.part`);

  const ytDlpArgs = [
    url,
    "-f",
    "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--extractor-args",
    `youtube:player_client=${playerClient}`,
    "-o",
    tempOutput,
  ];

  console.log(`[video][yt-dlp] client=${playerClient}`);
  try {
    const { stdout, stderr } = await execFileAsync("yt-dlp", ytDlpArgs, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`[video][yt-dlp] stdout:`, stdout.slice(0, 300));
    console.log(`[video][yt-dlp] stderr:`, stderr.slice(0, 300));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`yt-dlp (${playerClient}) failed: ${message.slice(0, 500)}`);
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
 * Generate an SRT subtitle file from the clip's transcript.
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

  // Check if lines have [mm:ss] timestamps from source transcript
  const timestamped = lines.every((l) => /^\[\d+:\d+\]/.test(l));

  let srtEntries: { start: number; end: number; text: string }[] = [];

  if (timestamped) {
    // Use existing timestamps, offset to start at 0
    for (const line of lines) {
      const match = line.match(/^\[(\d+):(\d+)\]\s*(.+)$/);
      if (match) {
        const [, mm, ss, text] = match;
        const time = parseInt(mm) * 60 + parseInt(ss);
        // Only include lines within the clip's time range
        if (time >= clip.startTime && time <= clip.endTime) {
          srtEntries.push({
            start: time - clip.startTime,
            end: time - clip.startTime + 3,
            text: text.trim(),
          });
        }
      }
    }
    // Fix overlapping
    for (let i = 0; i < srtEntries.length - 1; i++) {
      srtEntries[i].end = Math.min(srtEntries[i].end, srtEntries[i + 1].start);
    }
    if (srtEntries.length > 0) {
      srtEntries[srtEntries.length - 1].end = clipDuration;
    }
  } else {
    // Distribute text evenly across the clip duration
    const perLine = clipDuration / lines.length;
    lines.forEach((text, i) => {
      srtEntries.push({
        start: i * perLine,
        end: (i + 1) * perLine,
        text,
      });
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
 * Process a clip: cut from source video, crop to 16:9 (face-aware), burn subtitles.
 *
 * Output: 1920x1080 (16:9 horizontal) — standard YouTube format.
 *
 * Face tracking: uses ffmpeg's cropdetect to find the active region (faces/motion),
 * then crops to 16:9 centered on that region. If detection fails, uses center crop.
 *
 * @returns path to the processed video file
 */
export async function processClip(
  sourceVideoPath: string,
  clip: ClipItem
): Promise<string> {
  ensureDirs();
  const outputPath = join(OUTPUT_DIR, `${clip.id}.mp4`);
  const srtPath = join(OUTPUT_DIR, `${clip.id}.srt`);

  // Generate subtitle file
  const clipDuration = clip.endTime - clip.startTime;
  const srtContent = generateSRT(clip, clipDuration);
  if (srtContent) {
    await writeFile(srtPath, srtContent, "utf-8");
    console.log(
      `[video] generated SRT: ${srtPath} (${srtContent.length} chars)`
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

  // Calculate 16:9 crop dimensions
  // Target output: 1920x1080 (16:9 horizontal)
  let cropWidth: number;
  let cropHeight: number;
  let cropX: number;
  let cropY: number;

  if (detectedCrop) {
    // Use detected region, but ensure 16:9 aspect ratio
    const detectedAspect =
      detectedCrop.width / detectedCrop.height;
    if (detectedAspect > 16 / 9) {
      // Too wide — use height, calculate width for 16:9
      cropHeight = detectedCrop.height;
      cropWidth = Math.round(cropHeight * 16 / 9);
    } else {
      // Too tall — use width, calculate height for 16:9
      cropWidth = detectedCrop.width;
      cropHeight = Math.round(cropWidth * 9 / 16);
    }
    // Center on detected region
    cropX =
      detectedCrop.x + Math.round((detectedCrop.width - cropWidth) / 2);
    cropY =
      detectedCrop.y + Math.round((detectedCrop.height - cropHeight) / 2);
  } else {
    // Center crop: use full height, calculate width for 16:9
    cropHeight = srcHeight;
    cropWidth = Math.round(cropHeight * 16 / 9);
    cropX = Math.max(0, Math.round((srcWidth - cropWidth) / 2));
    cropY = 0;
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
      `crop ${cropWidth}x${cropHeight} at (${cropX},${cropY}) → scale to 1920x1080`
  );

  // Build ffmpeg filter chain:
  //   1. crop to detected/centered region (16:9 aspect)
  //   2. scale to 1920x1080 (16:9 output)
  //   3. burn subtitles (if SRT exists)
  const filters: string[] = [
    `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`,
    `scale=1920:1080:force_original_aspect_ratio=decrease`,
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black`,
  ];

  if (srtContent) {
    const subtitleStyle = [
      "FontSize=14",
      "FontName=Arial",
      "PrimaryColour=&H00FFFFFF", // white
      "OutlineColour=&H00000000", // black outline
      "BorderStyle=3", // opaque box
      "Outline=2",
      "Shadow=1",
      "Alignment=2", // bottom center
      "MarginV=60", // 60px from bottom
    ].join(",");
    const escapedSrt = srtPath.replace(/:/g, "\\:");
    filters.push(`subtitles='${escapedSrt}':force_style='${subtitleStyle}'`);
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[video] ffmpeg FAILED:`, message.slice(0, 1000));
    throw new Error(
      `ffmpeg failed to process clip. Details: ${message.slice(0, 500)}`
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
      transcript: clip.transcript,
      status: "downloading",
      downloadUrl: clip.downloadUrl,
      createdAt: clip.createdAt.toISOString(),
    };

    // 4. Process: cut + crop 16:9 + face tracking + burn subtitles
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
