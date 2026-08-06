// PUT /api/clips/[id]/subtitle  — save edited subtitle entries back to DB
//
// Accepts a JSON body:
//   { entries: SubtitleEntry[] }
//
// Converts the entries back into the transcript string format
//   [83.4] some text\n[85.2] more text
// and persists to clip.transcript.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formatTimestamp } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SubtitleEntry {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate body
    const body = await req.json();
    const entries: SubtitleEntry[] = body?.entries;
    if (!Array.isArray(entries)) {
      return NextResponse.json(
        { error: "Field 'entries' harus berupa array." },
        { status: 400 }
      );
    }

    // Check clip exists
    const clip = await db.clip.findUnique({ where: { id } });
    if (!clip) {
      return NextResponse.json({ error: "Clip tidak ditemukan." }, { status: 404 });
    }

    // Convert entries → transcript string:  [mm:ss.s] text
    const lines = entries
      .sort((a, b) => a.startTime - b.startTime)
      .map((e) => `[${formatTimestamp(e.startTime)}] ${e.text}`)
      .join("\n");

    // Update the clip's transcript field
    await db.clip.update({
      where: { id },
      data: { transcript: lines || null },
    });

    return NextResponse.json({ success: true, transcript: lines });
  } catch (err) {
    console.error("[PUT /api/clips/[id]/subtitle]", err);
    return NextResponse.json(
      { error: "Gagal menyimpan subtitle." },
      { status: 500 }
    );
  }
}
