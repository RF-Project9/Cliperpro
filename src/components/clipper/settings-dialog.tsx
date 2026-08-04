"use client";

import { useState } from "react";
import { KeyRound, Loader2, Eye, EyeOff, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useSettings, useUpdateSettings } from "@/lib/queries";
import { useClipperStore } from "@/lib/store";
import { toast } from "sonner";
import type { SettingsResponse } from "@/lib/api";

const MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o mini · fast & affordable" },
  { value: "gpt-4o", label: "GPT-4o · highest quality" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

export function SettingsDialog() {
  const open = useClipperStore((s) => s.settingsOpen);
  const setOpen = useClipperStore((s) => s.setSettingsOpen);
  const { data: settings, isFetched } = useSettings();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-area-pretty sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-violet-400" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Configure your OpenAI API key and clip preferences.
          </DialogDescription>
        </DialogHeader>

        {isFetched && settings ? (
          <SettingsForm
            key={`${settings.openaiModel}-${settings.clipCount}-${settings.minDuration}-${settings.maxDuration}-${settings.hasApiKey}`}
            settings={settings}
            onDone={() => setOpen(false)}
          />
        ) : (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({
  settings,
  onDone,
}: {
  settings: SettingsResponse;
  onDone: () => void;
}) {
  const mutation = useUpdateSettings();

  // initial state derived once when the form mounts (keyed remount keeps it in sync)
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings.openaiModel || "gpt-4o-mini");
  const [clipCount, setClipCount] = useState(settings.clipCount ?? 5);
  const [durationRange, setDurationRange] = useState<[number, number]>([
    settings.minDuration ?? 30,
    settings.maxDuration ?? 60,
  ]);
  const [showKey, setShowKey] = useState(false);

  async function handleSave() {
    try {
      await mutation.mutateAsync({
        openaiApiKey: apiKey || undefined,
        openaiModel: model,
        clipCount,
        minDuration: durationRange[0],
        maxDuration: durationRange[1],
      });
      toast.success("Settings saved");
      setApiKey("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    }
  }

  return (
    <>
      <div className="space-y-6 py-2">
        {/* API key status */}
        {settings.hasApiKey && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-200">
              API key active
              {settings.apiKeyMasked && (
                <span className="ml-1 font-mono text-emerald-300/80">
                  ({settings.apiKeyMasked})
                </span>
              )}
              {settings.apiKeySource === "env" && (
                <Badge
                  variant="outline"
                  className="ml-2 border-emerald-500/30 text-emerald-300"
                >
                  from env
                </Badge>
              )}
            </span>
          </div>
        )}

        {/* API key */}
        <div className="space-y-2">
          <Label htmlFor="apikey" className="text-sm font-medium">
            OpenAI API Key
          </Label>
          <div className="relative">
            <Input
              id="apikey"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.hasApiKey ? "•••••••••••••••• (saved)" : "sk-..."}
              className="pr-10 font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Stored locally in this app&apos;s database. Get your key at{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-violet-300 hover:underline"
            >
              platform.openai.com <ExternalLink className="size-3" />
            </a>
            .
          </p>
        </div>

        {/* Model */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">OpenAI Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Clip count */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Number of clips</Label>
            <Badge variant="outline" className="font-mono">
              {clipCount}
            </Badge>
          </div>
          <Slider
            value={[clipCount]}
            min={1}
            max={10}
            step={1}
            onValueChange={(v) => setClipCount(v[0])}
          />
        </div>

        {/* Duration range */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Clip duration (seconds)</Label>
            <Badge variant="outline" className="font-mono">
              {durationRange[0]}-{durationRange[1]}s
            </Badge>
          </div>
          <Slider
            value={durationRange}
            min={15}
            max={90}
            step={5}
            onValueChange={(v) => setDurationRange([v[0], v[1]] as [number, number])}
          />
          <p className="text-xs text-muted-foreground">
            Ideal for YouTube Shorts is 30-60 seconds.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={mutation.isPending}
          className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
        >
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Save settings
        </Button>
      </div>
    </>
  );
}
