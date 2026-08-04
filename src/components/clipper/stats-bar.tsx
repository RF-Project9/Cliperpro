"use client";

import { Film, Sparkles, TrendingUp, Clock } from "lucide-react";
import { useClipperStore } from "@/lib/store";
import { formatDuration } from "@/lib/youtube";

export function StatsBar() {
  const videos = useClipperStore((s) => s.videos);

  const completed = videos.filter((v) => v.status === "completed");
  const totalClips = completed.reduce((sum, v) => sum + (v.clipCount || 0), 0);
  const totalDuration = completed.reduce((sum, v) => sum + (v.duration || 0), 0);

  const stats = [
    {
      label: "Videos processed",
      value: completed.length.toString(),
      icon: Film,
      color: "text-violet-300",
      bg: "bg-violet-500/10",
    },
    {
      label: "Clips generated",
      value: totalClips.toString(),
      icon: Sparkles,
      color: "text-fuchsia-300",
      bg: "bg-fuchsia-500/10",
    },
    {
      label: "Content analyzed",
      value: totalDuration > 0 ? formatDuration(totalDuration) : "0:00",
      icon: Clock,
      color: "text-sky-300",
      bg: "bg-sky-500/10",
    },
    {
      label: "Avg clips / video",
      value: completed.length
        ? (totalClips / completed.length).toFixed(1)
        : "0",
      icon: TrendingUp,
      color: "text-emerald-300",
      bg: "bg-emerald-500/10",
    },
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 pb-2 sm:px-6 lg:px-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 p-4 backdrop-blur-sm"
          >
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${s.bg}`}>
              <s.icon className={`size-5 ${s.color}`} />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight sm:text-2xl">
                {s.value}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {s.label}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
