"use client";

import { Sparkles, Heart } from "lucide-react";

export function ClipperFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-card/30">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500">
            <Sparkles className="size-3.5 text-white" />
          </div>
          <span>
            <span className="font-semibold text-foreground">ViralClip AI</span>
            {" — "}
            AI Video Clipper for YouTube Shorts
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Built with</span>
          <Heart className="size-3.5 fill-fuchsia-500 text-fuchsia-500" />
          <span>using Next.js, OpenAI & Prisma</span>
        </div>
      </div>
    </footer>
  );
}
