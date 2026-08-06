"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  SplitSquareVertical,
  Save,
  Loader2,
  Type,
  Palette,
  AlignVerticalSpaceAround,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClipperStore, type SubtitleEntry } from "@/lib/store";
import { getEmbedUrl, formatTimestamp } from "@/lib/youtube";
import { toast } from "sonner";
import { ClipItem } from "@/lib/types";

// ─── Transcript parser ───────────────────────────────────────────────────────
// Supports both formats:  [83.4] text  and  [1:23.4] text

function parseTimestamp(ts: string): number {
  const trimmed = ts.trim();
  // mm:ss or mm:ss.s
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  // plain seconds
  return parseFloat(trimmed) || 0;
}

export function parseTranscript(raw: string): SubtitleEntry[] {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const entries: SubtitleEntry[] = [];

  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!match) continue;
    const startTime = parseTimestamp(match[1]);
    const text = match[2].trim();
    if (!text) continue;
    entries.push({
      id: crypto.randomUUID(),
      startTime,
      endTime: 0, // will be inferred from next entry
      text,
    });
  }

  // Infer endTime for each entry from the next entry's startTime
  for (let i = 0; i < entries.length; i++) {
    entries[i].endTime =
      i < entries.length - 1
        ? entries[i + 1].startTime
        : entries[i].startTime + 3; // default 3s for last entry
  }

  return entries;
}

// ─── Color presets ───────────────────────────────────────────────────────────

const TEXT_COLORS = [
  { label: "Putih", value: "#ffffff" },
  { label: "Kuning", value: "#facc15" },
  { label: "Cyan", value: "#22d3ee" },
];

const FONT_SIZES: Record<string, { label: string; css: string }> = {
  kecil: { label: "Kecil", css: "text-sm" },
  sedang: { label: "Sedang", css: "text-base" },
  besar: { label: "Besar", css: "text-xl" },
};

const POSITIONS = [
  { value: "atas", label: "Atas" },
  { value: "tengah", label: "Tengah" },
  { value: "bawah", label: "Bawah" },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface SubtitleEditorProps {
  clip: ClipItem;
  youtubeId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SubtitleEditor({ clip, youtubeId }: SubtitleEditorProps) {
  const {
    subtitleEntries,
    setSubtitleEntries,
    selectedSubtitleId,
    setSelectedSubtitleId,
    updateSubtitleEntry,
    addSubtitleEntry,
    deleteSubtitleEntry,
    moveSubtitleEntry,
    subtitleStyle,
    setSubtitleStyle,
  } = useClipperStore();

  const [saving, setSaving] = useState(false);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Parse transcript into entries on mount / when clip changes
  useEffect(() => {
    if (clip.transcript) {
      setSubtitleEntries(parseTranscript(clip.transcript));
    } else {
      setSubtitleEntries([]);
    }
  }, [clip.id, clip.transcript, setSubtitleEntries]);

  // Current selected entry
  const selectedEntry = useMemo(
    () => subtitleEntries.find((e) => e.id === selectedSubtitleId) ?? null,
    [subtitleEntries, selectedSubtitleId]
  );

  // Auto-select first entry when entries load
  useEffect(() => {
    if (subtitleEntries.length > 0 && !selectedSubtitleId) {
      setSelectedSubtitleId(subtitleEntries[0].id);
    }
  }, [subtitleEntries, selectedSubtitleId, setSelectedSubtitleId]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleAddEntry = useCallback(() => {
    const lastEntry = subtitleEntries[subtitleEntries.length - 1];
    const startTime = lastEntry ? lastEntry.endTime : clip.startTime;
    const newEntry: SubtitleEntry = {
      id: crypto.randomUUID(),
      startTime: Math.round(startTime * 10) / 10,
      endTime: Math.round((startTime + 3) * 10) / 10,
      text: "",
    };
    addSubtitleEntry(newEntry);
    setSelectedSubtitleId(newEntry.id);
    // Focus the new entry's textarea after render
    setTimeout(() => {
      textareaRefs.current[newEntry.id]?.focus();
    }, 50);
  }, [subtitleEntries, clip.startTime, addSubtitleEntry, setSelectedSubtitleId]);

  const handleSplitEntry = useCallback(() => {
    if (!selectedEntry) return;
    const textarea = textareaRefs.current[selectedEntry.id];
    const cursorPos = textarea?.selectionStart ?? Math.floor(selectedEntry.text.length / 2);
    const before = selectedEntry.text.slice(0, cursorPos).trimEnd();
    const after = selectedEntry.text.slice(cursorPos).trimStart();

    if (!before || !after) {
      toast.info("Letakkan kursor di tengah teks untuk membagi subtitle.");
      return;
    }

    const splitTime =
      selectedEntry.startTime +
      (selectedEntry.endTime - selectedEntry.startTime) *
        (cursorPos / Math.max(selectedEntry.text.length, 1));

    // Update existing entry
    updateSubtitleEntry(selectedEntry.id, {
      text: before,
      endTime: Math.round(splitTime * 10) / 10,
    });

    // Create new entry after it
    const newEntry: SubtitleEntry = {
      id: crypto.randomUUID(),
      startTime: Math.round(splitTime * 10) / 10,
      endTime: selectedEntry.endTime,
      text: after,
    };
    addSubtitleEntry(newEntry);
    setSelectedSubtitleId(newEntry.id);
    toast.success("Subtitle berhasil dibagi.");
  }, [selectedEntry, updateSubtitleEntry, addSubtitleEntry, setSelectedSubtitleId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clips/${clip.id}/subtitle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: subtitleEntries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menyimpan.");
      toast.success("Subtitle berhasil disimpan!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan subtitle.");
    } finally {
      setSaving(false);
    }
  }, [clip.id, subtitleEntries]);

  const handleResetStyle = useCallback(() => {
    setSubtitleStyle({
      fontSize: "sedang",
      textColor: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 0.6,
      position: "bawah",
    });
    toast.info("Gaya subtitle direset ke default.");
  }, [setSubtitleStyle]);

  // ─── Subtitle overlay styles ──────────────────────────────────────────────

  const subtitleOverlayClass = useMemo(() => {
    const positionMap = {
      atas: "top-[8%]",
      tengah: "top-1/2 -translate-y-1/2",
      bawah: "bottom-[8%]",
    };
    return `${positionMap[subtitleStyle.position]} ${FONT_SIZES[subtitleStyle.fontSize].css}`;
  }, [subtitleStyle.fontSize, subtitleStyle.position]);

  const activeSubtitleText = useMemo(() => {
    if (!selectedEntry) return "";
    return selectedEntry.text;
  }, [selectedEntry]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ─── Left Panel: Subtitle List ───────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Type className="size-4 text-violet-400" />
            Daftar Subtitle
            <Badge variant="outline" className="text-xs">
              {subtitleEntries.length} baris
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={handleAddEntry}
            >
              <Plus className="size-3" />
              Tambah
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={handleSplitEntry}
              disabled={!selectedEntry || !selectedEntry.text}
            >
              <SplitSquareVertical className="size-3" />
              Bagi
            </Button>
          </div>
        </div>

        {/* Entry list */}
        <div className="max-h-[420px] overflow-y-auto scroll-area-pretty rounded-xl border border-border/60 bg-muted/30">
          {subtitleEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Type className="size-8 opacity-40" />
              <p className="text-sm">Belum ada subtitle.</p>
              <p className="text-xs">Klik &quot;Tambah&quot; untuk membuat baris baru.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border/40">
              {subtitleEntries.map((entry, idx) => (
                <div
                  key={entry.id}
                  onClick={() => setSelectedSubtitleId(entry.id)}
                  className={`group flex cursor-pointer items-start gap-2 p-3 transition-colors ${
                    selectedSubtitleId === entry.id
                      ? "bg-violet-500/10 border-l-2 border-l-violet-500"
                      : "hover:bg-muted/50 border-l-2 border-l-transparent"
                  }`}
                >
                  {/* Row number */}
                  <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {idx + 1}
                    </span>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSubtitleEntry(entry.id, "up");
                        }}
                        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                        disabled={idx === 0}
                        aria-label="Pindah ke atas"
                      >
                        <ChevronUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSubtitleEntry(entry.id, "down");
                        }}
                        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                        disabled={idx === subtitleEntries.length - 1}
                        aria-label="Pindah ke bawah"
                      >
                        <ChevronDown className="size-3" />
                      </button>
                    </div>
                  </div>

                  {/* Timestamp + Text */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={formatTimestamp(entry.startTime)}
                        onChange={(e) => {
                          const val = parseTimestampInput(e.target.value);
                          updateSubtitleEntry(entry.id, { startTime: val });
                        }}
                        className="h-6 w-20 flex-none font-mono text-xs"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Waktu mulai"
                      />
                      <span className="text-[10px] text-muted-foreground">→</span>
                      <Input
                        value={formatTimestamp(entry.endTime)}
                        onChange={(e) => {
                          const val = parseTimestampInput(e.target.value);
                          updateSubtitleEntry(entry.id, { endTime: val });
                        }}
                        className="h-6 w-20 flex-none font-mono text-xs"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Waktu selesai"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSubtitleEntry(entry.id);
                        }}
                        className="ml-auto shrink-0 rounded p-1 text-red-400 opacity-0 transition-opacity hover:bg-red-500/10 group-hover:opacity-100"
                        aria-label="Hapus subtitle"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                    <Textarea
                      ref={(el) => {
                        if (el) textareaRefs.current[entry.id] = el;
                      }}
                      value={entry.text}
                      onChange={(e) => {
                        updateSubtitleEntry(entry.id, {
                          text: e.target.value,
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      rows={Math.max(1, Math.ceil(entry.text.length / 50))}
                      className="min-h-[2rem] resize-none border-border/40 bg-transparent p-1.5 text-xs leading-relaxed focus-visible:ring-1 focus-visible:ring-violet-500/50"
                      placeholder="Teks subtitle..."
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Right Panel: Preview + Controls ──────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:w-[380px]">
        {/* YouTube preview */}
        <div className="flex items-center justify-between text-sm font-semibold">
          <span>Pratinjau Video</span>
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border/60 bg-black">
          <iframe
            src={getEmbedUrl(youtubeId, clip.startTime, clip.endTime)}
            title={clip.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="size-full"
          />
          {/* Subtitle overlay */}
          {activeSubtitleText && (
            <div
              className={`pointer-events-none absolute left-0 right-0 ${subtitleOverlayClass} flex justify-center px-4`}
            >
              <span
                className="rounded-md px-3 py-1 font-semibold drop-shadow-lg"
                style={{
                  color: subtitleStyle.textColor,
                  backgroundColor: hexToRgba(subtitleStyle.bgColor, subtitleStyle.bgOpacity),
                  fontSize: subtitleStyle.fontSize === "kecil"
                    ? "0.875rem"
                    : subtitleStyle.fontSize === "sedang"
                    ? "1rem"
                    : "1.25rem",
                }}
              >
                {activeSubtitleText}
              </span>
            </div>
          )}
        </div>

        {/* Current subtitle info */}
        {selectedEntry && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
            <div className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-violet-300">
              <span>Subtitle terpilih</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                #{subtitleEntries.findIndex((e) => e.id === selectedEntry.id) + 1}
              </Badge>
            </div>
            <p className="text-sm text-foreground/80">
              {selectedEntry.text || <span className="italic text-muted-foreground">(kosong)</span>}
            </p>
            <p className="mt-1 text-[11px] font-mono text-muted-foreground">
              {formatTimestamp(selectedEntry.startTime)} → {formatTimestamp(selectedEntry.endTime)}{" "}
              ({(selectedEntry.endTime - selectedEntry.startTime).toFixed(1)}s)
            </p>
          </div>
        )}

        <Separator className="opacity-60" />

        {/* ─── Styling Options ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Palette className="size-4 text-fuchsia-400" />
            Gaya Teks
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={handleResetStyle}
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        </div>

        <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          {/* Font size */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Ukuran Font</Label>
            <Select
              value={subtitleStyle.fontSize}
              onValueChange={(v) =>
                setSubtitleStyle({
                  ...subtitleStyle,
                  fontSize: v as SubtitleStyle["fontSize"],
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FONT_SIZES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Text color */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Warna Teks</Label>
            <div className="flex items-center gap-2">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() =>
                    setSubtitleStyle({ ...subtitleStyle, textColor: c.value })
                  }
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    subtitleStyle.textColor === c.value
                      ? "border-violet-400 ring-2 ring-violet-400/30"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                  aria-label={`Warna ${c.label}`}
                />
              ))}
            </div>
          </div>

          {/* Background opacity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Transparansi Latar
              </Label>
              <span className="text-xs font-mono text-muted-foreground">
                {Math.round(subtitleStyle.bgOpacity * 100)}%
              </span>
            </div>
            <Slider
              value={[subtitleStyle.bgOpacity * 100]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) =>
                setSubtitleStyle({ ...subtitleStyle, bgOpacity: v / 100 })
              }
              className="w-full"
            />
          </div>

          {/* Position */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlignVerticalSpaceAround className="size-3" />
              Posisi
            </Label>
            <div className="flex items-center gap-2">
              {POSITIONS.map((p) => (
                <Button
                  key={p.value}
                  size="sm"
                  variant={
                    subtitleStyle.position === p.value ? "default" : "outline"
                  }
                  className={`h-7 text-xs ${
                    subtitleStyle.position === p.value
                      ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white"
                      : ""
                  }`}
                  onClick={() =>
                    setSubtitleStyle({
                      ...subtitleStyle,
                      position: p.value as SubtitleStyle["position"],
                    })
                  }
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Save button ──────────────────────────────────────────────── */}
        <Button
          onClick={handleSave}
          disabled={saving || subtitleEntries.length === 0}
          className="h-9 gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? "Menyimpan..." : "Simpan Subtitle"}
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a user-typed timestamp string back into seconds.
 * Accepts formats: "83.4", "1:23.4", "1:23", "1:23"
 */
function parseTimestampInput(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  return parseFloat(trimmed) || 0;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
