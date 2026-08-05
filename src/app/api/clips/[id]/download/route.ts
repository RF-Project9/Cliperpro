// GET /api/clips/[id]/download
// Streams the rendered clip video file to the client.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClipFilePath } from "@/lib/video-processor";
import { statSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clipId = (await params).id;

    const clip = await db.clip.findUnique({ where: { id: clipId } });
    if (!clip) {
      return NextResponse.json({ error: "Clip not found." }, { status: 404 });
    }

    if (clip.status !== "downloaded") {
      return NextResponse.json(
        {
          error:
            "Clip has not been rendered yet. Call POST /api/clips/[id]/render first.",
        },
        { status: 409 }
      );
    }

    const filePath = getClipFilePath(clipId);

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return NextResponse.json(
        {
          error:
            "Rendered file not found on disk. The file may have been cleaned up (Railway ephemeral disk). Please render the clip again.",
        },
        { status: 410 }
      );
    }

    // Stream the file as video/mp4 with download headers
    const fileName = `${clip.title
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .slice(0, 50)}.mp4`;

    const stream = createReadStream(filePath);
    const readable = Readable.toWeb(stream) as unknown as ReadableStream;

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
    console.error("[download route] error:", err);
    return NextResponse.json(
      { error: "Failed to download clip." },
      { status: 500 }
    );
  }
}
