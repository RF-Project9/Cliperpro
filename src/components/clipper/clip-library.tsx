"use client";

import { Trash2, ExternalLink, AlertCircle, Loader2, Film, ChevronDown } from "lucide-react";
import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVideos, useDeleteVideo } from "@/lib/queries";
import { useClipperStore } from "@/lib/store";
import { toast } from "sonner";
import { formatDuration } from "@/lib/youtube";
import { ClipCard } from "./clip-card";
import { ClipLibrarySkeleton } from "./skeletons";
import { EmptyState } from "./empty-state";

export function ClipLibrary() {
  const { data: videos, isLoading, isError, refetch } = useVideos();
  const deleteMutation = useDeleteVideo();
  const storeVideos = useClipperStore((s) => s.videos);
  const upsertVideo = useClipperStore((s) => s.upsertVideo);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (isLoading) return <ClipLibrarySkeleton />;

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto mb-4 size-10 text-destructive" />
        <h3 className="mb-2 text-lg font-semibold">Couldn&apos;t load your clips</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Something went wrong while fetching your library.
        </p>
        <Button variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  // Merge server data with optimistic store updates
  const merged = (videos ?? []).map((v) => {
    const store = storeVideos.find((s) => s.id === v.id);
    return store ? { ...v, ...store, clips: v.clips } : v;
  });

  // Include optimistic videos not yet in server data (just-processed)
  const optimisticOnly = storeVideos.filter(
    (s) => !merged.some((m) => m.id === s.id)
  );

  const all = [...merged, ...optimisticOnly.map((s) => ({ ...s, clips: [] } as typeof merged[number]))];

  if (all.length === 0) return <EmptyState />;

  async function handleDelete(id: string, title: string) {
    try {
      await deleteMutation.mutateAsync(id);
      // remove from store optimistically
      const remaining = useClipperStore.getState().videos.filter((v) => v.id !== id);
      useClipperStore.getState().setVideos(remaining);
      toast.success(`Deleted "${title || "video"}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-8">
      {all.map((video) => {
        const isCollapsed = collapsed[video.id];
        const clipCount = video.clips?.length ?? video.clipCount ?? 0;
        return (
          <section key={video.id} className="space-y-4">
            {/* Video header */}
            <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/50 p-4 sm:flex-row sm:items-center">
              <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-black sm:w-40">
                {video.thumbnail ? (
                  <Image
                    src={video.thumbnail}
                    alt={video.title || "thumbnail"}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : null}
                {video.status === "processing" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <Loader2 className="size-6 animate-spin text-violet-300" />
                  </div>
                )}
                {video.status === "failed" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                    <AlertCircle className="size-6 text-destructive" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {video.status === "completed" && (
                    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                      {clipCount} clips
                    </Badge>
                  )}
                  {video.status === "processing" && (
                    <Badge className="border-violet-500/30 bg-violet-500/10 text-violet-300">
                      <Loader2 className="mr-1 size-3 animate-spin" />
                      Processing
                    </Badge>
                  )}
                  {video.status === "failed" && (
                    <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
                      Failed
                    </Badge>
                  )}
                  {video.duration ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {formatDuration(video.duration)}
                    </Badge>
                  ) : null}
                </div>
                <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug sm:text-base">
                  {video.title || video.url}
                </h3>
                {video.channel && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {video.channel}
                  </p>
                )}
                {video.status === "failed" && video.error && (
                  <p className="mt-1 text-xs text-destructive">{video.error}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  onClick={() => window.open(video.url, "_blank", "noopener")}
                  title="Open on YouTube"
                >
                  <ExternalLink className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(video.id, video.title || "")}
                  disabled={deleteMutation.isPending}
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            {/* Clips grid */}
            {video.status === "completed" && video.clips && video.clips.length > 0 ? (
              <>
                {clipCount > 6 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [video.id]: !c[video.id] }))
                    }
                  >
                    <ChevronDown
                      className={`size-4 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                    />
                    {isCollapsed ? "Show all clips" : "Show less"}
                  </Button>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(isCollapsed ? video.clips.slice(0, 6) : video.clips).map((clip) => (
                    <ClipCard key={clip.id} clip={clip} video={video} />
                  ))}
                </div>
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
