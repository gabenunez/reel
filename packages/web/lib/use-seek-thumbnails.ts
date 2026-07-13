"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface SeekThumbnailCue {
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SeekThumbnails {
  spriteUrl: string;
  cues: SeekThumbnailCue[];
}

function parseVttSpriteCues(vtt: string): SeekThumbnailCue[] {
  const cues: SeekThumbnailCue[] = [];
  const blocks = vtt.split(/\n\s*\n/).slice(1);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    const timing = lines[0]?.match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/,
    );
    const spriteRef = lines[1];
    if (!timing || !spriteRef) continue;

    const toMs = (stamp: string) => {
      const [h, m, rest] = stamp.split(":");
      const [s, ms] = rest.split(".");
      return (
        parseInt(h, 10) * 3_600_000 +
        parseInt(m, 10) * 60_000 +
        parseInt(s, 10) * 1000 +
        parseInt(ms, 10)
      );
    };

    const xywh = spriteRef.match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
    if (!xywh) continue;

    cues.push({
      startMs: toMs(timing[1]),
      endMs: toMs(timing[2]),
      x: parseInt(xywh[1], 10),
      y: parseInt(xywh[2], 10),
      width: parseInt(xywh[3], 10),
      height: parseInt(xywh[4], 10),
    });
  }

  return cues;
}

function findCue(cues: SeekThumbnailCue[], timeMs: number): SeekThumbnailCue | null {
  for (const cue of cues) {
    if (timeMs >= cue.startMs && timeMs < cue.endMs) return cue;
  }
  return cues.length > 0 ? cues[cues.length - 1] : null;
}

export function useSeekThumbnails(
  fileId: number,
  type: "movie" | "episode",
  enabled: boolean,
): {
  thumbnails: SeekThumbnails | null;
  lookupCue: (timeMs: number) => SeekThumbnailCue | null;
} {
  const [thumbnails, setThumbnails] = useState<SeekThumbnails | null>(null);

  useEffect(() => {
    if (!enabled || !fileId || Number.isNaN(fileId)) {
      setThumbnails(null);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40;
    const retryDelayMs = 3_000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (cancelled || attempts >= maxAttempts) return;
      attempts += 1;
      timer = window.setTimeout(() => {
        void load();
      }, retryDelayMs);
    };

    const load = async () => {
      try {
        const vttUrl = api.thumbnailVttUrl(fileId, type);
        const res = await fetch(vttUrl, { credentials: "include" });

        // 202 = generation in progress; keep polling without treating as failure.
        if (res.status === 202 || res.status === 503) {
          scheduleRetry();
          return;
        }

        // Hard miss / unavailable — stop so the console is not spammed with 404s.
        if (res.status === 404 || res.status === 401) {
          return;
        }

        if (!res.ok) {
          scheduleRetry();
          return;
        }

        const vtt = await res.text();
        const cues = parseVttSpriteCues(vtt);
        if (!cues.length || cancelled) return;

        const spriteUrl = api.thumbnailSpriteUrl(fileId, type);
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = spriteUrl;
        });

        if (cancelled) return;

        setThumbnails({
          spriteUrl,
          cues,
        });
      } catch {
        scheduleRetry();
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, fileId, type]);

  return {
    thumbnails,
    lookupCue: (timeMs: number) =>
      thumbnails ? findCue(thumbnails.cues, timeMs) : null,
  };
}

export type { SeekThumbnailCue, SeekThumbnails };
