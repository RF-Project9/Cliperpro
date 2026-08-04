// Zustand store for client-side UI state

import { create } from "zustand";
import { ClipItem, VideoItem } from "./types";

interface ClipperState {
  // recently processed videos (kept in memory for instant UI feedback)
  videos: VideoItem[];
  setVideos: (v: VideoItem[]) => void;
  upsertVideo: (v: VideoItem) => void;

  // the video whose clips are shown in the detail dialog
  selectedVideo: VideoItem | null;
  selectedClips: ClipItem[];
  selectVideo: (video: VideoItem | null, clips: ClipItem[]) => void;

  // processing state
  isProcessing: boolean;
  processingUrl: string;
  setProcessing: (v: boolean, url?: string) => void;

  // settings dialog
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
}

export const useClipperStore = create<ClipperState>((set) => ({
  videos: [],
  setVideos: (videos) => set({ videos }),
  upsertVideo: (v) =>
    set((state) => {
      const existing = state.videos.find((x) => x.id === v.id);
      const videos = existing
        ? state.videos.map((x) => (x.id === v.id ? v : x))
        : [v, ...state.videos];
      return { videos };
    }),

  selectedVideo: null,
  selectedClips: [],
  selectVideo: (video, clips) =>
    set({ selectedVideo: video, selectedClips: clips }),

  isProcessing: false,
  processingUrl: "",
  setProcessing: (isProcessing, processingUrl = "") =>
    set({ isProcessing, processingUrl }),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
