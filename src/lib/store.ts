// Zustand store for client-side UI state

import { create } from "zustand";
import { ClipItem, VideoItem } from "./types";

// ─── Subtitle editor types ───────────────────────────────────────────────────

export interface SubtitleEntry {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface SubtitleStyle {
  fontSize: "kecil" | "sedang" | "besar";
  textColor: string;       // CSS color
  bgColor: string;        // CSS color
  bgOpacity: number;       // 0 – 1
  position: "atas" | "tengah" | "bawah";
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: "sedang",
  textColor: "#ffffff",
  bgColor: "#000000",
  bgOpacity: 0.6,
  position: "bawah",
};

// ─── Store interface ─────────────────────────────────────────────────────────

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

  // subtitle editor state
  subtitleEditorOpen: boolean;
  setSubtitleEditorOpen: (v: boolean) => void;
  subtitleEntries: SubtitleEntry[];
  setSubtitleEntries: (entries: SubtitleEntry[]) => void;
  selectedSubtitleId: string | null;
  setSelectedSubtitleId: (id: string | null) => void;
  updateSubtitleEntry: (id: string, updates: Partial<SubtitleEntry>) => void;
  addSubtitleEntry: (entry: SubtitleEntry) => void;
  deleteSubtitleEntry: (id: string) => void;
  moveSubtitleEntry: (id: string, direction: "up" | "down") => void;
  subtitleStyle: SubtitleStyle;
  setSubtitleStyle: (style: SubtitleStyle) => void;
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
    set({ selectedVideo: video, selectedClips: clips, subtitleEditorOpen: false }),

  isProcessing: false,
  processingUrl: "",
  setProcessing: (isProcessing, processingUrl = "") =>
    set({ isProcessing, processingUrl }),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  // subtitle editor
  subtitleEditorOpen: false,
  setSubtitleEditorOpen: (subtitleEditorOpen) => set({ subtitleEditorOpen }),
  subtitleEntries: [],
  setSubtitleEntries: (subtitleEntries) => set({ subtitleEntries }),
  selectedSubtitleId: null,
  setSelectedSubtitleId: (selectedSubtitleId) => set({ selectedSubtitleId }),
  updateSubtitleEntry: (id, updates) =>
    set((state) => ({
      subtitleEntries: state.subtitleEntries.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    })),
  addSubtitleEntry: (entry) =>
    set((state) => ({
      subtitleEntries: [...state.subtitleEntries, entry],
    })),
  deleteSubtitleEntry: (id) =>
    set((state) => ({
      subtitleEntries: state.subtitleEntries.filter((e) => e.id !== id),
      selectedSubtitleId:
        state.selectedSubtitleId === id ? null : state.selectedSubtitleId,
    })),
  moveSubtitleEntry: (id, direction) =>
    set((state) => {
      const idx = state.subtitleEntries.findIndex((e) => e.id === id);
      if (idx < 0) return state;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= state.subtitleEntries.length) return state;
      const entries = [...state.subtitleEntries];
      [entries[idx], entries[swapIdx]] = [entries[swapIdx], entries[idx]];
      return { subtitleEntries: entries };
    }),
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  setSubtitleStyle: (subtitleStyle) => set({ subtitleStyle }),
}));
