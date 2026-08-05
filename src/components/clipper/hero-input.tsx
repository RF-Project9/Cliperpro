"use client";

import { useState } from "react";
import { Sparkles, Link2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { processVideo } from "@/lib/api";
import { useClipperStore } from "@/lib/store";
import { isValidYouTubeUrl } from "@/lib/youtube";
import { useSettings } from "@/lib/queries";

export function HeroInput() {
  const [url, setUrl] = useState("");
  const { isProcessing, processingUrl, setProcessing, upsertVideo, setVideos } =
    useClipperStore();
  const { data: settings } = useSettings();

  const hasApiKey = settings?.hasApiKey;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("Please paste a YouTube video URL.");
      return;
    }
    if (!isValidYouTubeUrl(trimmed)) {
      toast.error("That doesn't look like a valid YouTube URL.");
      return;
    }
    if (!hasApiKey) {
      toast.error("Add your OpenAI API key in Settings first.");
      return;
    }

    setProcessing(true, trimmed);
    try {
      const result = await processVideo(trimmed);
      const video = result.video;
      upsertVideo({
        id: video.id,
        url: video.url,
        youtubeId: video.youtubeId,
        title: video.title,
        channel: video.channel,
        thumbnail: video.thumbnail,
        duration: video.duration,
        status: video.status,
        error: video.error,
        clipCount: video.clips.length,
        createdAt: video.createdAt,
      });
      // refresh the server list so the new (or failed) video is reflected
      setVideos(useClipperStore.getState().videos);
      if (video.status === "failed") {
        toast.error(video.error || "Failed to generate clips.");
      } else {
        toast.success(`Generated ${video.clips.length} viral clips!`);
      }
      setUrl("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process video.";
      toast.error(message);
    } finally {
      setProcessing(false);
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
        toast.success("Pasted from clipboard");
      }
    } catch {
      toast.error("Couldn't access clipboard. Paste manually.");
    }
  }

  return (
    <section className="relative overflow-hidden">
      <div className="aurora-bg">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 pb-12 pt-16 text-center sm:pt-24 sm:pb-16">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs font-medium text-violet-200">
          <Sparkles className="size-3.5" />
          Powered by OpenAI · Detect viral moments automatically
        </div>

        <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-6xl">
          Turn long videos into
          <br className="hidden sm:block" />{" "}
          <span className="gradient-text">viral YouTube Shorts</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
          Paste any YouTube link. Our AI watches the transcript, finds the most
          viral moments, and cuts them into ready-to-post 30-60 second clips.
        </p>

        <form onSubmit={handleSubmit} className="mx-auto mt-8 max-w-2xl">
          <div className="gradient-border flex flex-col gap-2 rounded-2xl p-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={isProcessing}
                className="h-12 border-0 bg-transparent pl-10 text-base shadow-none focus-visible:ring-0"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={handlePaste}
                disabled={isProcessing}
                className="hidden sm:inline-flex"
              >
                Paste
              </Button>
              <Button
                type="submit"
                size="lg"
                disabled={isProcessing}
                className="h-12 gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/30 hover:from-violet-600 hover:to-fuchsia-600"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Clipping…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Generate Clips
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>

        {isProcessing && (
          <div className="mx-auto mt-6 flex max-w-md items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-left text-sm text-violet-200">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <div>
              <p className="font-medium">Analyzing video & detecting viral moments…</p>
              <p className="text-xs text-violet-300/70">
                Fetching transcript, then asking OpenAI to score every moment.
                This usually takes 20-45 seconds.
              </p>
            </div>
          </div>
        )}

        {!hasApiKey && !isProcessing && (
          <div className="mx-auto mt-6 flex max-w-md items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left text-sm text-amber-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">OpenAI API key required</p>
              <p className="text-xs text-amber-200/70">
                Open Settings and paste your OpenAI API key to start clipping.
              </p>
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Supports YouTube URLs · Requires video captions/transcript · No login
          needed
        </p>
      </div>
    </section>
  );
}
