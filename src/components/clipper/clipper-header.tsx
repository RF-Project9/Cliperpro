"use client";

import { Scissors, Settings, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useClipperStore } from "@/lib/store";

export function ClipperHeader() {
  const setSettingsOpen = useClipperStore((s) => s.setSettingsOpen);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/30">
            <Scissors className="size-5 text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight">
              ViralClip <span className="gradient-text">AI</span>
            </span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              AI Video Clipper · YouTube Shorts
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="hidden border-violet-500/30 bg-violet-500/10 text-violet-300 sm:flex"
          >
            <span className="mr-1 size-1.5 rounded-full bg-emerald-400" />
            Online
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => window.open("https://github.com", "_blank", "noopener")}
            aria-label="GitHub"
          >
            <Github className="size-5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="gap-2"
          >
            <Settings className="size-4" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
