// POST /api/clips/[id]/render
// Renders a clip into a downloadable 16:9 video with subtitles + face tracking.
//
// Two response modes:
//   - If client sends Accept: application/json → returns JSON { success, downloadUrl, fileSize }
//   - Otherwise → streams the rendered MP4 file directly as a download
//
// This dual-mode lets the UI update status (JSON) OR trigger a direct file download.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { renderClip } from "@/lib/video-processor";
import { serializeClip } from "@/lib/serialize";
import { createReadStream, statSync, existsSync } from "node:fs";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for rendering

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const clipId = (await params).id;
  const wantsJson =
    req.headers.get("accept")?.includes("application/json") ?? false;

  try {
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

    // Render the clip (download + ffmpeg process)
    const { downloadUrl, fileSize, filePath } = await renderClip(clipId);

    // Verify the file exists
    if (!existsSync(filePath)) {
      throw new Error("Rendered file not found on disk after render.");
    }

    // Re-fetch the updated clip
    const updated = await db.clip.findUnique({ where: { id: clipId } });

    if (wantsJson) {
      // Return JSON response (for UI status updates)
      return NextResponse.json({
        success: true,
        downloadUrl,
        fileSize,
        clip: updated ? serializeClip(updated) : null,
      });
    }

    // Stream the file directly as a download response
    const fileName = `${clip.title
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .slice(0, 50)}.mp4`;

    const stat = statSync(filePath);
    const stream = createReadStream(filePath);
    const readable = Readable.toWeb(stream) as unknown as ReadableStream;

    console.log(
      `[render route] streaming file directly: ${fileName} (${stat.size} bytes)`
    );

    return new NextResponse(readable, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    console.error("[render route] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to render clip.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
