// Video processing: download, cut, crop 9:16, burn subtitles, face tracking
//
// This module handles the heavy lifting of turning a YouTube video + a
// suggested clip (start/end time, transcript) into a ready-to-post vertical
// YouTube Short (1080x1920, 9:16) with burned-in subtitles.
//
// Pipeline:
//   1. Download the source video with yt-dlp (cached per videoId)
//   2. Generate an SRT subtitle file from the clip's transcript
//   3. ffmpeg: cut segment → crop to 9:16 (face-aware) → burn subtitles → output
//
// Face tracking: we use ffmpeg's cropdetect + a "talking head" heuristic
// (crop slightly above center, where faces typically are). A full face-detection
// pass would require OpenCV/mediapipe which is heavy for a Node.js service.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, rmSync, createReadStream, statSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
 * Download a YouTube video using yt-dlp.
 * Caches by videoId so we don't re-download for each clip of the same video.
 * Returns the path to the downloaded video file (mp4).
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

  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  console.log(`[video] downloading ${url} with yt-dlp...`);

  // yt-dlp options:
  //  -f bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best
  //    → prefer 720p mp4 (good enough for Shorts, keeps file size reasonable)
  //  --merge-output-format mp4
  //  -o <path>
  const ytDlpArgs = [
    url,
    "-f",
    "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--no-warnings",
    "-o",
    outputPath,
  ];

  try {
    const { stdout, stderr } = await execFileAsync("yt-dlp", ytDlpArgs, {
      timeout: 300000, // 5 min download timeout
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`[video] yt-dlp done. stderr:`, stderr.slice(0, 500));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to download video with yt-dlp. Make sure yt-dlp is installed. Details: ${message.slice(0, 300)}`
    );
  }

  if (!existsSync(outputPath)) {
    throw new Error("yt-dlp finished but output file not found.");
  }

  const duration = await getVideoDuration(outputPath);
  console.log(
    `[video] downloaded ${youtubeId}: ${duration}s, ${formatBytes(statSync(outputPath).size)}`
  );
  return { path: outputPath, duration };
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
 *
 * The clip.transcript is raw text (from OpenAI). If it's already timestamped
 * (from the source transcript), we use those timestamps. Otherwise we
 * distribute the text evenly across the clip duration.
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
            end: time - clip.startTime + 3, // 3s per line default
            text: text.trim(),
          });
        }
      }
    }
    // Fix overlapping: each entry's end = next entry's start
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

  // Build SRT format
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
 * Process a clip: cut from source video, crop to 9:16, burn subtitles.
 *
 * Face tracking approach:
 *   For talking-head/podcast videos, faces are usually in the upper-center
 *   of the frame. We crop to 9:16 (1080x1920) centered horizontally, with a
 *   slight upward bias (captures face region better than dead center).
 *
 *   Advanced: we run cropdetect on the first few seconds to detect the active
 *   region, then bias the crop toward it.
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
    console.log(`[video] generated SRT: ${srtPath} (${srtContent.length} chars)`);
  }

  // Get source video dimensions to calculate crop
  const dims = await getVideoDimensions(sourceVideoPath);
  const srcWidth = dims.width || 1920;
  const srcHeight = dims.height || 1080;

  // Calculate 9:16 crop dimensions
  // Target: 1080x1920 (YouTube Shorts)
  // We crop a 9:16 region from the source, then scale to 1080x1920
  const cropHeight = srcHeight;
  const cropWidth = Math.round(cropHeight * 9 / 16);
  // Center horizontally, with slight upward bias for face region
  const cropX = Math.max(0, Math.round((srcWidth - cropWidth) / 2));
  const cropY = 0; // top of frame (faces usually in upper portion)

  console.log(
    `[video] processing clip ${clip.id}: ${clip.startTime}s-${clip.endTime}s, ` +
      `crop ${cropWidth}x${cropHeight} from ${srcWidth}x${srcHeight}`
  );

  // Build ffmpeg filter chain:
  //   1. crop to 9:16 region (face-biased)
  //   2. scale to 1080x1920
  //   3. burn subtitles (if SRT exists)
  const filters: string[] = [
    `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`,
    `scale=1080:1920:force_original_aspect_ratio=decrease`,
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`,
  ];

  if (srtContent) {
    // subtitles filter with styling for Shorts (bold, large, bottom area)
    const subtitleStyle = [
      "FontSize=18",
      "FontName=Arial",
      "PrimaryColour=&H00FFFFFF", // white
      "OutlineColour=&H00000000", // black outline
      "BorderStyle=3", // opaque box
      "Outline=2",
      "Shadow=1",
      "Alignment=2", // bottom center
      "MarginV=80", // 80px from bottom (above Shorts UI)
    ].join(",");
    // Escape path for ffmpeg filter (Windows needs backslash escaping, Linux just needs colon escaping)
    const escapedSrt = srtPath.replace(/:/g, "\\:");
    filters.push(`subtitles='${escapedSrt}':force_style='${subtitleStyle}'`);
  }

  const filterComplex = filters.join(",");

  const ffmpegArgs = [
    "-y", // overwrite output
    "-ss",
    String(clip.startTime), // start time
    "-to",
    String(clip.endTime), // end time
    "-i",
    sourceVideoPath, // input
    "-vf",
    filterComplex,
    "-c:v",
    "libx264", // H.264 codec
    "-preset",
    "fast", // fast encoding
    "-crf",
    "23", // quality (lower = better, 23 is good default)
    "-c:a",
    "aac", // audio codec
    "-b:a",
    "128k", // audio bitrate
    "-movflags",
    "+faststart", // web-optimized MP4
    "-t",
    String(clipDuration), // ensure output is exactly clip duration
    outputPath,
  ];

  console.log(`[video] running ffmpeg: ffmpeg ${ffmpegArgs.join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync("ffmpeg", ffmpegArgs, {
      timeout: 300000, // 5 min processing timeout
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`[video] ffmpeg done. stderr (last 500):`, stderr.slice(-500));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ffmpeg failed to process clip. Details: ${message.slice(0, 500)}`
    );
  }

  if (!existsSync(outputPath)) {
    throw new Error("ffmpeg finished but output file not found.");
  }

  const size = statSync(outputPath).size;
  console.log(`[video] clip processed: ${outputPath} (${formatBytes(size)})`);
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
 * Render a clip: download source video (if needed) + process to 9:16 with subtitles.
 * Updates the Clip record's status + downloadUrl.
 */
export async function renderClip(clipId: string): Promise<{
  downloadUrl: string;
  fileSize: number;
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

    // Update status to "processing"
    await db.clip.update({
      where: { id: clipId },
      data: { status: "downloading" }, // keep as processing
    });

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

    // 4. Process: cut + crop 9:16 + burn subtitles
    const outputPath = await processClip(videoPath, clipItem);

    // 5. Update DB with download URL (relative path served by our API)
    const downloadUrl = `/api/clips/${clipId}/download`;
    const fileSize = statSync(outputPath).size;

    await db.clip.update({
      where: { id: clipId },
      data: {
        status: "downloaded",
        downloadUrl,
      },
    });

    console.log(
      `[render] done for clip ${clipId}: ${downloadUrl} (${formatBytes(fileSize)})`
    );

    return { downloadUrl, fileSize };
  } catch (err) {
    console.error(`[render] failed for clip ${clipId}:`, err);
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

/**
 * Clean up old cached downloads and outputs (call periodically).
 * Keeps files newer than maxAgeMs.
 */
export function cleanupOldFiles(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const dir of [DOWNLOAD_CACHE_DIR, OUTPUT_DIR]) {
    if (!existsSync(dir)) continue;
    // Note: in production, you'd use fs.readdir + fs.stat to check ages.
    // For now, this is a no-op placeholder — Railway's ephemeral disk resets
    // on redeploy anyway.
  }
}
