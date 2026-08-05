// OpenAI client setup for ViralClip AI

import OpenAI from "openai";
import { db } from "./db";

export async function getOpenAIClient(): Promise<{
  client: OpenAI;
  model: string;
}> {
  // 1. Try the database settings (user-provided key via UI).
  //    Wrap in try/catch — if the DB is unreachable or the Setting table
  //    doesn't exist yet, we must NOT crash; fall back to env var instead.
  let dbKey: string | undefined;
  let dbModel: string | undefined;
  try {
    const setting = await db.setting.findUnique({ where: { id: "default" } });
    dbKey = setting?.openaiApiKey?.trim() || undefined;
    dbModel = setting?.openaiModel?.trim() || undefined;
  } catch (err) {
    console.warn(
      "[openai] DB query for settings failed, falling back to env var:",
      err instanceof Error ? err.message : err
    );
  }

  // 2. Fall back to environment variable (for Railway deployment)
  const envKey = process.env.OPENAI_API_KEY?.trim();
  const envModel = process.env.OPENAI_MODEL?.trim();

  const apiKey = dbKey || envKey;
  const model = dbModel || envModel || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error(
      "OpenAI API key not configured. Please add your API key in Settings, " +
        "or set the OPENAI_API_KEY environment variable on Railway."
    );
  }

  console.log(
    "[openai] using key source:",
    dbKey ? "database" : "env",
    "| model:",
    model
  );

  const client = new OpenAI({ apiKey });
  return { client, model };
}

export async function getSettings() {
  let setting = null;
  try {
    setting = await db.setting.findUnique({ where: { id: "default" } });
  } catch (err) {
    console.warn(
      "[openai] DB query for settings failed, using defaults:",
      err instanceof Error ? err.message : err
    );
  }
  return {
    openaiApiKey: setting?.openaiApiKey ?? null,
    openaiModel: setting?.openaiModel ?? "gpt-4o-mini",
    clipCount: setting?.clipCount ?? 5,
    minDuration: setting?.minDuration ?? 30,
    maxDuration: setting?.maxDuration ?? 60,
    hasApiKey: Boolean(
      setting?.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim()
    ),
  };
}
