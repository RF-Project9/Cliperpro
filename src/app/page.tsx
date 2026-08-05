"use client";

import { Providers } from "@/components/providers";
import { ClipperHeader } from "@/components/clipper/clipper-header";
import { HeroInput } from "@/components/clipper/hero-input";
import { StatsBar } from "@/components/clipper/stats-bar";
import { ClipLibrary } from "@/components/clipper/clip-library";
import { SettingsDialog } from "@/components/clipper/settings-dialog";
import { ClipDetailDialog } from "@/components/clipper/clip-detail-dialog";
import { ClipperFooter } from "@/components/clipper/clipper-footer";

export default function Home() {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <ClipperHeader />
        <main className="flex-1">
          <HeroInput />
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-6 lg:px-8">
            <StatsBar />

            {/* Section title */}
            <div className="mb-5 mt-10 flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                Your clip library
              </h2>
            </div>

            <ClipLibrary />
          </div>
        </main>
        <ClipperFooter />
        <SettingsDialog />
        <ClipDetailDialog />
      </div>
    </Providers>
  );
}
