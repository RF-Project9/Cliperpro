// React Query hooks for server state

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchVideos,
  fetchSettings,
  processVideo,
  deleteVideo,
  updateSettings,
  type SettingsResponse,
} from "./api";
import { useClipperStore } from "./store";

export function useVideos() {
  const setVideos = useClipperStore((s) => s.setVideos);
  return useQuery({
    queryKey: ["videos"],
    queryFn: async () => {
      const videos = await fetchVideos();
      setVideos(videos.map((v) => ({
        id: v.id,
        url: v.url,
        youtubeId: v.youtubeId,
        title: v.title,
        channel: v.channel,
        thumbnail: v.thumbnail,
        duration: v.duration,
        status: v.status,
        error: v.error,
        clipCount: v.clips.length,
        createdAt: v.createdAt,
      })));
      return videos;
    },
  });
}

export function useSettings() {
  return useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });
}

export function useProcessVideo() {
  const qc = useQueryClient();
  const upsertVideo = useClipperStore((s) => s.upsertVideo);
  return useMutation({
    mutationFn: (url: string) => processVideo(url),
    onSuccess: (data) => {
      upsertVideo({
        id: data.video.id,
        url: data.video.url,
        youtubeId: data.video.youtubeId,
        title: data.video.title,
        channel: data.video.channel,
        thumbnail: data.video.thumbnail,
        duration: data.video.duration,
        status: data.video.status,
        error: data.video.error,
        clipCount: data.video.clips.length,
        createdAt: data.video.createdAt,
      });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });
}

export function useDeleteVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVideo(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
