// GET /api/settings  -> current app settings (api key masked)
// PUT /api/settings  -> update settings

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const setting = await db.setting.findUnique({ where: { id: "default" } });
  const envKey = process.env.OPENAI_API_KEY?.trim();
  const dbKey = setting?.openaiApiKey?.trim();
  const hasApiKey = Boolean(dbKey || envKey);

  return NextResponse.json({
    hasApiKey,
    // return a masked preview if a key exists
    apiKeyMasked: dbKey
      ? dbKey.slice(0, 3) + "•".repeat(Math.max(0, dbKey.length - 7)) + dbKey.slice(-4)
      : envKey
        ? envKey.slice(0, 3) + "•".repeat(Math.max(0, envKey.length - 7)) + envKey.slice(-4)
        : null,
    apiKeySource: dbKey ? "database" : envKey ? "env" : null,
    openaiModel: setting?.openaiModel ?? "gpt-4o-mini",
    clipCount: setting?.clipCount ?? 5,
    minDuration: setting?.minDuration ?? 30,
    maxDuration: setting?.maxDuration ?? 60,
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const openaiModel = String(body?.openaiModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
    const clipCount = clampInt(body?.clipCount, 1, 10, 5);
    const minDuration = clampInt(body?.minDuration, 10, 60, 30);
    const maxDuration = clampInt(body?.maxDuration, 30, 180, 60);

    // Only update the key if a non-empty string was provided.
    // An empty string clears the stored key (falls back to env).
    const providedKey = body?.openaiApiKey;
    const data: Record<string, unknown> = {
      openaiModel,
      clipCount,
      minDuration,
      maxDuration,
    };
    if (typeof providedKey === "string" && providedKey.trim() !== "") {
      data.openaiApiKey = providedKey.trim();
    } else if (providedKey === "") {
      data.openaiApiKey = null;
    }

    const updated = await db.setting.upsert({
      where: { id: "default" },
      update: data,
      create: {
        id: "default",
        openaiModel,
        clipCount,
        minDuration,
        maxDuration,
        openaiApiKey: typeof providedKey === "string" && providedKey.trim() ? providedKey.trim() : null,
      },
    });

    const envKey = process.env.OPENAI_API_KEY?.trim();
    const hasApiKey = Boolean(updated.openaiApiKey || envKey);

    return NextResponse.json({
      success: true,
      hasApiKey,
      openaiModel: updated.openaiModel,
      clipCount: updated.clipCount,
      minDuration: updated.minDuration,
      maxDuration: updated.maxDuration,
    });
  } catch (err) {
    console.error("[PUT /api/settings]", err);
    return NextResponse.json(
      { error: "Failed to save settings." },
      { status: 500 }
    );
  }
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}
