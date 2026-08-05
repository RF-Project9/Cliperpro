// POST /api/clips  -> process a YouTube URL and generate viral clips
// GET  /api/clips  -> list all processed videos

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractYouTubeId, fetchVideoMeta, fetchTranscript } from "@/lib/youtube";
import { detectViralClips } from "@/lib/clipper";
import { serializeVideo, serializeVideoWithClips } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for the processing request

export async function GET() {
  try {
    const videos = await db.video.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        clips: { orderBy: { score: "desc" } },
        _count: { select: { clips: true } },
      },
    });
    return NextResponse.json({
      videos: videos.map((v) => serializeVideoWithClips(v)),
    });
  } catch (err) {
    console.error("[GET /api/clips]", err);
    return NextResponse.json(
      { error: "Failed to load videos." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url: string = String(body?.url ?? "").trim();

    if (!url) {
      return NextResponse.json({ error: "Please provide a video URL." }, { status: 400 });
    }

    const youtubeId = extractYouTubeId(url);
    if (!youtubeId) {
      return NextResponse.json(
        {
          error:
            "Invalid YouTube URL. Please provide a link like https://www.youtube.com/watch?v=... or https://youtu.be/...",
        },
        { status: 400 }
      );
    }

    // Create the video record as "processing"
    const video = await db.video.create({
      data: {
        url,
        youtubeId,
        status: "processing",
        thumbnail: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
      },
    });

    try {
      // 1. Fetch metadata (title, channel) in parallel with transcript
      console.log("[POST /api/clips] fetching transcript for", youtubeId);
      const [meta, segments] = await Promise.all([
        fetchVideoMeta(youtubeId),
        fetchTranscript(youtubeId),
      ]);
      console.log(
        "[POST /api/clips] transcript OK:",
        segments.length,
        "segments, title:",
        meta.title
      );

      await db.video.update({
        where: { id: video.id },
        data: {
          title: meta.title,
          channel: meta.channel,
          thumbnail: meta.thumbnail,
          transcript: segments.map((s) => `[${s.start.toFixed(1)}] ${s.text}`).join("\n"),
        },
      });

      // 2. Detect viral clips with OpenAI
      console.log("[POST /api/clips] calling OpenAI to detect viral clips...");
      const suggested = await detectViralClips(segments);
      console.log(
        "[POST /api/clips] OpenAI returned",
        suggested.length,
        "clips"
      );

      // 3. Persist clips
      const last = segments[segments.length - 1];
      const totalDuration = last ? last.start + (last.duration || 0) : null;

      if (suggested.length > 0) {
        await db.clip.createMany({
          data: suggested.map((c) => ({
            videoId: video.id,
            startTime: c.startTime,
            endTime: c.endTime,
            duration: c.endTime - c.startTime,
            title: c.title,
            description: c.description,
            reason: c.reason,
            score: c.score,
            hook: c.hook,
            hashtags: JSON.stringify(c.hashtags),
            transcript: c.transcript,
            status: "generated",
          })),
        });
        console.log("[POST /api/clips] persisted", suggested.length, "clips to DB");
      } else {
        console.warn("[POST /api/clips] no clips returned from OpenAI!");
      }

      const updated = await db.video.update({
        where: { id: video.id },
        data: {
          status: "completed",
          duration: totalDuration,
        },
        include: { clips: { orderBy: { score: "desc" } } },
      });

      return NextResponse.json({ video: serializeVideoWithClips(updated) });
    } catch (err) {
      console.error("[POST /api/clips] processing error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to process the video.";

      const failed = await db.video.update({
        where: { id: video.id },
        data: { status: "failed", error: message },
        include: { clips: { orderBy: { score: "desc" } } },
      });

      // Return 200 with the failed video so the UI can display it in the
      // library with the error message (better UX than a hard 500).
      return NextResponse.json({
        video: serializeVideoWithClips(failed),
        error: message,
      });
    }
  } catch (err) {
    console.error("[POST /api/clips] outer error:", err);
    return NextResponse.json(
      { error: "Unexpected server error. Please try again." },
      { status: 500 }
    );
  }
}
