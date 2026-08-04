// GET    /api/clips/[id]  -> fetch a single video with its clips
// DELETE /api/clips/[id]  -> delete a video and all its clips
// POST   /api/clips/[id]/reprocess -> re-run clip detection

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serializeVideoWithClips } from "@/lib/serialize";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const video = await db.video.findUnique({
      where: { id },
      include: { clips: { orderBy: { score: "desc" } } },
    });
    if (!video) {
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    }
    return NextResponse.json({ video: serializeVideoWithClips(video) });
  } catch (err) {
    console.error("[GET /api/clips/[id]]", err);
    return NextResponse.json({ error: "Failed to load video." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.video.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    }
    await db.video.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/clips/[id]]", err);
    return NextResponse.json({ error: "Failed to delete video." }, { status: 500 });
  }
}
