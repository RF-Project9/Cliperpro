"use client";

import {
  Play,
  Clock,
  Hash,
  Copy,
  Check,
  Flame,
  Download,
  Loader2,
  Film,
} from "lucide-react";
import { useState } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ClipItem, VideoItem } from "@/lib/types";
import { formatDuration, formatTimestamp } from "@/lib/youtube";
import { useClipperStore } from "@/lib/store";
import { renderClip, getDownloadUrl } from "@/lib/api";

interface Props {
  clip: ClipItem;
  video: VideoItem;
}

export function ClipCard({ clip, video }: Props) {
  const [copied, setCopied] = useState<"title" | "tags" | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [clipStatus, setClipStatus] = useState<ClipItem["status"]>(clip.status);
  const selectVideo = useClipperStore((s) => s.selectVideo);

  const thumb = video.thumbnail;
  const scoreColor = getScoreColor(clip.score);

  async function copyTitle() {
    try {
      await navigator.clipboard.writeText(clip.title);
      setCopied("title");
      toast.success("Title copied");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  async function copyHashtags() {
    const tags = (clip.hashtags ?? []).map((t) => `#${t}`).join(" ");
    try {
      await navigator.clipboard.writeText(tags);
      setCopied("tags");
      toast.success("Hashtags copied");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  function openPreview() {
    selectVideo(video, [clip]);
  }

  async function handleRender() {
    setIsRendering(true);
    setClipStatus("downloading");
    toast.info("Rendering clip... downloading video & processing with ffmpeg");
    try {
      const result = await renderClip(clip.id);
      setClipStatus("downloaded");
      toast.success(`Clip ready! (${formatBytes(result.fileSize)})`);
    } catch (err) {
      setClipStatus("failed");
      toast.error(err instanceof Error ? err.message : "Render failed");
    } finally {
      setIsRendering(false);
    }
  }

  function handleDownload() {
    window.open(getDownloadUrl(clip.id), "_blank");
  }

  return (
    <Card className="group relative overflow-hidden border-border/60 p-0 transition-all hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/10">
      {/* Thumbnail */}
      <button
        type="button"
        onClick={openPreview}
        className="relative block aspect-video w-full overflow-hidden bg-black"
        aria-label={`Preview ${clip.title}`}
      >
        {thumb ? (
          <Image
            src={thumb}
            alt={video.title || "Video thumbnail"}
            fill
            unoptimized
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Virality score badge */}
        <div
          className={`absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur-md ${scoreColor.bg} ${scoreColor.text}`}
        >
          <Flame className="size-3.5" />
          {Math.round(clip.score)}
        </div>

        {/* Duration badge */}
        <div className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-md">
          {formatDuration(clip.duration)}
        </div>

        {/* Status badge - show if rendering/downloaded */}
        {clipStatus === "downloading" && (
          <div className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-violet-500/80 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">
            <Loader2 className="size-3 animate-spin" />
            Rendering...
          </div>
        )}
        {clipStatus === "downloaded" && (
          <div className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-emerald-500/80 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">
            <Check className="size-3" />
            Ready
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex size-14 items-center justify-center rounded-full bg-white/90 text-black shadow-xl">
            <Play className="size-6 translate-x-0.5 fill-black" />
          </div>
        </div>

        {/* Timestamp range */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs font-medium text-white">
          <Clock className="size-3.5" />
          {formatTimestamp(clip.startTime)} - {formatTimestamp(clip.endTime)}
        </div>
      </button>

      {/* Content */}
      <div className="space-y-3 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
          {clip.title}
        </h3>

        {clip.hook && (
          <p className="line-clamp-2 text-xs italic text-muted-foreground">
            &ldquo;{clip.hook}&rdquo;
          </p>
        )}

        {clip.hashtags && clip.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {clip.hashtags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-medium text-violet-300"
              >
                #{t}
              </span>
            ))}
            {clip.hashtags.length > 4 && (
              <span className="text-[11px] text-muted-foreground">
                +{clip.hashtags.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Primary actions: Preview + Render/Download */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={openPreview}
            className="h-8 flex-1 gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
          >
            <Play className="size-3.5 fill-white" />
            Preview
          </Button>

          {clipStatus === "downloaded" ? (
            <Button
              size="sm"
              variant="default"
              onClick={handleDownload}
              className="h-8 flex-1 gap-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
            >
              <Download className="size-3.5" />
              Download
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRender}
              disabled={isRendering}
              className="h-8 flex-1 gap-1.5"
              title="Render this clip into a 9:16 video with subtitles"
            >
              {isRendering ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Rendering...
                </>
              ) : (
                <>
                  <Film className="size-3.5" />
                  Render
                </>
              )}
            </Button>
          )}
        </div>

        {/* Secondary actions: copy buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 gap-1.5 text-xs text-muted-foreground"
            onClick={copyTitle}
          >
            {copied === "title" ? (
              <Check className="size-3 text-emerald-400" />
            ) : (
              <Copy className="size-3" />
            )}
            Title
          </Button>
          {clip.hashtags && clip.hashtags.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 gap-1.5 text-xs text-muted-foreground"
              onClick={copyHashtags}
            >
              {copied === "tags" ? (
                <Check className="size-3 text-emerald-400" />
              ) : (
                <Hash className="size-3" />
              )}
              Tags
            </Button>
          )}
        </div>

        {/* Render info hint */}
        {clipStatus === "generated" && (
          <p className="text-[11px] text-muted-foreground">
            Click <strong>Render</strong> to create a 9:16 video with subtitles
            (takes 30-90s)
          </p>
        )}
      </div>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getScoreColor(score: number) {
  if (score >= 85) {
    return {
      bg: "bg-fuchsia-500/30",
      text: "text-fuchsia-100",
    };
  }
  if (score >= 70) {
    return {
      bg: "bg-violet-500/30",
      text: "text-violet-100",
    };
  }
  return {
    bg: "bg-slate-500/30",
    text: "text-slate-100",
  };
}
