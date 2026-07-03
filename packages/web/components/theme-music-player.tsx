"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

const THEME_MUSIC_ENABLED_KEY = "reel-theme-music-enabled";
const TARGET_VOLUME = 0.38;
const FADE_MS = 1800;
const MAX_PLAY_MS = 42_000;

function isThemeMusicEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(THEME_MUSIC_ENABLED_KEY);
  return stored !== "0";
}

function fadeVolume(
  audio: HTMLAudioElement,
  from: number,
  to: number,
  durationMs: number,
  onDone?: () => void,
): () => void {
  const started = performance.now();
  let frame = 0;

  const step = (now: number) => {
    const t = Math.min(1, (now - started) / durationMs);
    audio.volume = from + (to - from) * t;
    if (t < 1) {
      frame = requestAnimationFrame(step);
    } else {
      onDone?.();
    }
  };

  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

interface ThemeMusicPlayerProps {
  mediaId: number;
  enabled?: boolean;
}

export function ThemeMusicPlayer({ mediaId, enabled = true }: ThemeMusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopFadeRef = useRef<(() => void) | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !mediaId || !isThemeMusicEnabled()) return;

    const audio = new Audio(api.themeMusicUrl(mediaId));
    audio.preload = "auto";
    audio.volume = 0;
    audioRef.current = audio;

    let cancelled = false;
    let started = false;

    const cleanup = () => {
      cancelled = true;
      stopFadeRef.current?.();
      stopFadeRef.current = null;
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };

    const startPlayback = () => {
      if (cancelled || started) return;
      started = true;

      void audio.play().catch(() => cleanup());

      stopFadeRef.current = fadeVolume(audio, 0, TARGET_VOLUME, FADE_MS);

      const playForMs = Math.min(
        MAX_PLAY_MS,
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration * 1000
          : MAX_PLAY_MS,
      );

      stopTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        stopFadeRef.current = fadeVolume(audio, audio.volume, 0, FADE_MS, () => {
          cleanup();
        });
      }, playForMs);
    };

    audio.addEventListener("canplaythrough", startPlayback, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    audio.load();

    return cleanup;
  }, [mediaId, enabled]);

  return null;
}
