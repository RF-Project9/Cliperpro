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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useClipperStore } from "@/lib/store";
import { getEmbedUrl, formatDuration, formatTimestamp } from "@/lib/youtube";
import { toast } from "sonner";

export function ClipDetailDialog() {
  const { selectedVideo, selectedClips, selectVideo } = useClipperStore();
  const [copied, setCopied] = useState<string | null>(null);

  const open = selectedVideo !== null && selectedClips.length > 0;
  const clip = selectedClips[0];

  async function copy(text: string, key: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  if (!clip || !selectedVideo) return null;

  const youtubeId = selectedVideo.youtubeId;
  const youtubeWatchUrl = `https://www.youtube.com/watch?v=${youtubeId}&t=${Math.floor(clip.startTime)}s`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) selectVideo(null, []);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto scroll-area-pretty p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">{clip.title}</DialogTitle>

        {/* YouTube embed */}
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
              onClick={() => selectVideo(null, [])}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Hook */}
          {clip.hook && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-violet-300">
                <Quote className="size-3.5" />
                Opening hook
              </div>
              <p className="text-sm italic text-foreground/90">“{clip.hook}”</p>
            </div>
          )}

          {/* Reason */}
          {clip.reason && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-300">
                <Lightbulb className="size-3.5" />
                Why it&apos;s viral
              </div>
              <p className="text-sm text-foreground/80">{clip.reason}</p>
            </div>
          )}

          {/* Description */}
          {clip.description && (
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Description
              </h4>
              <p className="text-sm text-foreground/80">{clip.description}</p>
            </div>
          )}

          {/* Transcript */}
          {clip.transcript && (
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Clip transcript
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
                  Hashtags
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() =>
                    copy(
                      clip.hashtags!.map((t) => `#${t}`).join(" "),
                      "tags",
                      "Hashtags"
                    )
                  }
                >
                  {copied === "tags" ? (
                    <Check className="size-3 text-emerald-400" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy all
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

          {/* Actions */}
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => copy(clip.title, "title", "Title")}
            >
              {copied === "title" ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <Copy className="size-3.5" />
              )}
              Copy title
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                // Open YouTube at the start timestamp
                window.open(youtubeWatchUrl, "_blank", "noopener");
              }}
            >
              <ExternalLink className="size-3.5" />
              Open on YouTube
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
