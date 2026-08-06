"use client";

import { useState } from "react";
import {
  X,
  Copy,
  Check,
  Flame,
  Clock,
  Quote,
  Lightbulb,
  ExternalLink,
  Captions,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useClipperStore } from "@/lib/store";
import { getEmbedUrl, formatDuration, formatTimestamp } from "@/lib/youtube";
import { toast } from "sonner";
import { SubtitleEditor } from "./subtitle-editor";

type ViewMode = "preview" | "subtitle-editor";

export function ClipDetailDialog() {
  const { selectedVideo, selectedClips, selectVideo, subtitleEditorOpen, setSubtitleEditorOpen } =
    useClipperStore();
  const [copied, setCopied] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  const open = selectedVideo !== null && selectedClips.length > 0;
  const clip = selectedClips[0];

  async function copy(text: string, key: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success(`${label} disalin`);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  function handleClose() {
    selectVideo(null, []);
    setSubtitleEditorOpen(false);
    setViewMode("preview");
  }

  function openSubtitleEditor() {
    setViewMode("subtitle-editor");
    setSubtitleEditorOpen(true);
  }

  function backToPreview() {
    setViewMode("preview");
    setSubtitleEditorOpen(false);
  }

  if (!clip || !selectedVideo) return null;

  const youtubeId = selectedVideo.youtubeId;
  const youtubeWatchUrl = `https://www.youtube.com/watch?v=${youtubeId}&t=${Math.floor(clip.startTime)}s`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto scroll-area-pretty p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">{clip.title}</DialogTitle>

        {/* YouTube embed — hidden in subtitle editor mode */}
        {viewMode === "preview" && (
          <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-black">
            {open && (
              <iframe
                src={getEmbedUrl(youtubeId, clip.startTime, clip.endTime)}
                title={clip.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="size-full"
              />
            )}
          </div>
        )}

        <div className="space-y-5 p-5 sm:p-6">
          {/* Header row */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge
                  className={`gap-1 ${
                    clip.score >= 85
                      ? "border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-200"
                      : "border-violet-500/30 bg-violet-500/15 text-violet-200"
                  }`}
                >
                  <Flame className="size-3" />
                  Virality {Math.round(clip.score)}/100
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Clock className="size-3" />
                  {formatDuration(clip.duration)}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {formatTimestamp(clip.startTime)} → {formatTimestamp(clip.endTime)}
                </Badge>
              </div>
              <h2 className="text-lg font-bold leading-snug">{clip.title}</h2>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              onClick={handleClose}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* ─── View toggle buttons ──────────────────────────────────────── */}
          {clip.transcript && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={viewMode === "preview" ? "default" : "outline"}
                className={`gap-1.5 text-xs ${
                  viewMode === "preview"
                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white"
                    : ""
                }`}
                onClick={backToPreview}
              >
                Pratinjau
              </Button>
              <Button
                size="sm"
                variant={viewMode === "subtitle-editor" ? "default" : "outline"}
                className={`gap-1.5 text-xs ${
                  viewMode === "subtitle-editor"
                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white"
                    : ""
                }`}
                onClick={openSubtitleEditor}
              >
                <Captions className="size-3" />
                Edit Subtitle
              </Button>
            </div>
          )}

          {/* ─── Preview Mode (original content) ──────────────────────────── */}
          {viewMode === "preview" && (
            <>
              {/* Hook */}
              {clip.hook && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-violet-300">
                    <Quote className="size-3.5" />
                    Pembuka
                  </div>
                  <p className="text-sm italic text-foreground/90">&ldquo;{clip.hook}&rdquo;</p>
                </div>
              )}

              {/* Reason */}
              {clip.reason && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-300">
                    <Lightbulb className="size-3.5" />
                    Kenapa viral
                  </div>
                  <p className="text-sm text-foreground/80">{clip.reason}</p>
                </div>
              )}

              {/* Description */}
              {clip.description && (
                <div>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Deskripsi
                  </h4>
                  <p className="text-sm text-foreground/80">{clip.description}</p>
                </div>
              )}

              {/* Transcript */}
              {clip.transcript && (
                <div>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Transcript klip
                  </h4>
                  <div className="max-h-48 overflow-y-auto scroll-area-pretty rounded-xl border border-border/60 bg-muted/30 p-3 text-sm leading-relaxed text-foreground/70">
                    {clip.transcript}
                  </div>
                </div>
              )}

              {/* Hashtags */}
              {clip.hashtags && clip.hashtags.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Hashtag
                    </h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() =>
                        copy(
                          clip.hashtags!.map((t) => `#${t}`).join(" "),
                          "tags",
                          "Hashtag"
                        )
                      }
                    >
                      {copied === "tags" ? (
                        <Check className="size-3 text-emerald-400" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      Salin semua
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {clip.hashtags.map((t) => (
                      <span
                        key={t}
                        className="rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-200"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <Separator className="opacity-60" />

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => copy(clip.title, "title", "Judul")}
                >
                  {copied === "title" ? (
                    <Check className="size-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  Salin judul
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    window.open(youtubeWatchUrl, "_blank", "noopener");
                  }}
                >
                  <ExternalLink className="size-3.5" />
                  Buka di YouTube
                </Button>
                {clip.transcript && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={openSubtitleEditor}
                  >
                    <Captions className="size-3.5" />
                    Edit Subtitle
                  </Button>
                )}
              </div>
            </>
          )}

          {/* ─── Subtitle Editor Mode ─────────────────────────────────────── */}
          {viewMode === "subtitle-editor" && clip.transcript !== undefined && (
            <SubtitleEditor clip={clip} youtubeId={youtubeId} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
