"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function ClipLibrarySkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/50 p-4 sm:flex-row sm:items-center">
        <Skeleton className="aspect-video w-full shrink-0 rounded-lg sm:w-40" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-border/60 bg-card"
          >
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
