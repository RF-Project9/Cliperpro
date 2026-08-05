// Shared types for ViralClip AI

export type VideoStatus = "pending" | "processing" | "completed" | "failed";

export type ClipStatus =
  | "generated"
  | "downloading"
  | "downloaded"
  | "failed";

export interface VideoItem {
  id: string;
  url: string;
  youtubeId: string;
  title: string | null;
  channel: string | null;
  thumbnail: string | null;
  duration: number | null;
  status: VideoStatus;
  error: string | null;
  clipCount: number;
  createdAt: string;
}

export interface ClipItem {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  duration: number;
  title: string;
  description: string | null;
  reason: string | null;
  score: number;
  hook: string | null;
  hashtags: string[] | null;
  transcript: string | null;
  status: ClipStatus;
  downloadUrl: string | null;
  createdAt: string;
}

export interface VideoWithClips extends VideoItem {
  clips: ClipItem[];
}

export interface Settings {
  openaiApiKey: string | null;
  openaiModel: string;
  clipCount: number;
  minDuration: number;
  maxDuration: number;
}

// Transcript segment from YouTube
export interface TranscriptSegment {
  text: string;
  start: number; // seconds
  duration: number; // seconds
}

// A clip suggested by the AI
export interface SuggestedClip {
  startTime: number;
  endTime: number;
  title: string;
  description: string;
  reason: string;
  score: number;
  hook: string;
  hashtags: string[];
  transcript: string;
}
