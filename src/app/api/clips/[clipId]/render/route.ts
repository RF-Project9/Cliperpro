// POST /api/clips/[clipId]/render
// Renders a clip into a downloadable 9:16 video with subtitles.
// This is a long-running operation (30-90s) that downloads the source video
// and processes it with ffmpeg.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { renderClip } from "@/lib/video-processor";
import { serializeClip } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for rendering

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  try {
    const { clipId } = await params;

    const clip = await db.clip.findUnique({
      where: { id: clipId },
      include: { video: true },
    });

    if (!clip) {
      return NextResponse.json({ error: "Clip not found." }, { status: 404 });
    }

    if (!clip.video) {
      return NextResponse.json(
        { error: "Source video not found." },
        { status: 404 }
      );
    }

    console.log(`[render route] rendering clip ${clipId}`);

    const { downloadUrl, fileSize } = await renderClip(clipId);

    // Re-fetch the updated clip
    const updated = await db.clip.findUnique({
      where: { id: clipId },
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Clip disappeared after render." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      downloadUrl,
      fileSize,
      clip: serializeClip(updated),
    });
  } catch (err) {
    console.error("[render route] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to render clip.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
