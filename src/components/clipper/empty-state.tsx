"use client";

import { Sparkles, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-16 text-center">
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
        <Sparkles className="size-8 text-violet-300" />
      </div>
      <h3 className="mb-2 text-lg font-semibold">No clips yet</h3>
      <p className="mx-auto mb-6 max-w-md text-sm text-muted-foreground">
        Paste a YouTube link above to let AI find the most viral moments and
        turn them into ready-to-post YouTube Shorts.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-muted-foreground">Try a popular video:</span>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            const input = document.querySelector<HTMLInputElement>(
              'input[placeholder*="youtube.com"]'
            );
            if (input) {
              const sampleUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value"
              )?.set;
              setter?.call(input, sampleUrl);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.focus();
              input.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }}
        >
          <Youtube className="size-4" />
          Load sample URL
        </Button>
      </div>
    </div>
  );
}
