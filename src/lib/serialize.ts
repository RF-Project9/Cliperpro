// Helper to serialize Prisma records into plain API response shapes.

import { Clip, Video } from "@prisma/client";
import { ClipItem, VideoItem, VideoWithClips } from "./types";

export function serializeVideo(
  v: Video & { _count?: { clips: number }; clips?: Clip[] }
): VideoItem {
  return {
    id: v.id,
    url: v.url,
    youtubeId: v.youtubeId,
    title: v.title,
    channel: v.channel,
    thumbnail: v.thumbnail,
    duration: v.duration,
    status: v.status as VideoItem["status"],
    error: v.error,
    clipCount: v.clips?.length ?? v._count?.clips ?? 0,
    createdAt: v.createdAt.toISOString(),
  };
}

export function serializeClip(c: Clip): ClipItem {
  let hashtags: string[] | null = null;
  if (c.hashtags) {
    try {
      const parsed = JSON.parse(c.hashtags);
      if (Array.isArray(parsed)) hashtags = parsed.map(String);
    } catch {
      hashtags = null;
    }
  }
  return {
    id: c.id,
    videoId: c.videoId,
    startTime: c.startTime,
    endTime: c.endTime,
    duration: c.duration,
    title: c.title,
    description: c.description,
    reason: c.reason,
    score: c.score,
    hook: c.hook,
    hashtags,
    transcript: c.transcript,
    status: c.status as ClipItem["status"],
    downloadUrl: c.downloadUrl,
    createdAt: c.createdAt.toISOString(),
  };
}

export function serializeVideoWithClips(
  v: Video & { clips: Clip[] }
): VideoWithClips {
  return {
    ...serializeVideo(v),
    clips: v.clips.map(serializeClip),
  };
}
