// OpenAI client setup for ViralClip AI

import OpenAI from "openai";
import { db } from "./db";

export async function getOpenAIClient(): Promise<{
  client: OpenAI;
  model: string;
}> {
  // 1. Try the database settings (user-provided key via UI)
  const setting = await db.setting.findUnique({ where: { id: "default" } });
  const dbKey = setting?.openaiApiKey?.trim();

  // 2. Fall back to environment variable (for Railway deployment)
  const envKey = process.env.OPENAI_API_KEY?.trim();

  const apiKey = dbKey || envKey;
  const model = setting?.openaiModel?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error(
      "OpenAI API key not configured. Please add your API key in Settings, or set the OPENAI_API_KEY environment variable."
    );
  }

  const client = new OpenAI({ apiKey });
  return { client, model };
}

export async function getSettings() {
  const setting = await db.setting.findUnique({ where: { id: "default" } });
  return {
    openaiApiKey: setting?.openaiApiKey ?? null,
    openaiModel: setting?.openaiModel ?? "gpt-4o-mini",
    clipCount: setting?.clipCount ?? 5,
    minDuration: setting?.minDuration ?? 30,
    maxDuration: setting?.maxDuration ?? 60,
    hasApiKey: Boolean(setting?.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim()),
  };
}
