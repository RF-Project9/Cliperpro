// API client functions for ViralClip AI

import { Settings, VideoItem, VideoWithClips } from "./types";

export async function fetchVideos(): Promise<VideoWithClips[]> {
  const res = await fetch("/api/clips", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to load videos.");
  return data.videos as VideoWithClips[];
}

export async function fetchVideo(id: string): Promise<VideoWithClips> {
  const res = await fetch(`/api/clips/${id}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to load video.");
  return data.video as VideoWithClips;
}

export interface ProcessResult {
  video: VideoWithClips;
}

export async function processVideo(url: string): Promise<ProcessResult> {
  const res = await fetch("/api/clips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to process video.");
  return data as ProcessResult;
}

export async function deleteVideo(id: string): Promise<void> {
  const res = await fetch(`/api/clips/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to delete video.");
}

export interface SettingsResponse {
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  apiKeySource: "database" | "env" | null;
  openaiModel: string;
  clipCount: number;
  minDuration: number;
  maxDuration: number;
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to load settings.");
  return data as SettingsResponse;
}

export async function updateSettings(payload: Partial<Settings> & {
  openaiApiKey?: string;
}): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to save settings.");
  return data as SettingsResponse;
}
