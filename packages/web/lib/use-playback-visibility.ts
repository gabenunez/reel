"use client";

import { useEffect, useRef } from "react";
import type Hls from "hls.js";
import { api, type StreamQuality } from "@/lib/api";
import { destroyHlsInstance } from "@/lib/playback-engine";
import { syncNativePlaybackState } from "@/lib/android-bridge";

interface PlaybackVisibilityOptions {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.RefObject<Hls | null>;
  fileId: number;
  type: "movie" | "episode";
  usingHlsPlayback: boolean;
  usesNativePlayer?: boolean;
  onSaveProgress: () => void;
}

export function usePlaybackVisibility(options: PlaybackVisibilityOptions): void {
  const {
    enabled,
    videoRef,
    hlsRef,
    fileId,
    type,
    usingHlsPlayback,
    usesNativePlayer = false,
    onSaveProgress,
  } = options;

  const wasPlayingRef = useRef(false);
  const onSaveProgressRef = useRef(onSaveProgress);
  onSaveProgressRef.current = onSaveProgress;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    const onVisibilityChange = () => {
      const hidden = document.visibilityState === "hidden";
      const video = videoRef.current;

      if (hidden) {
        wasPlayingRef.current = usesNativePlayer
          ? false
          : Boolean(video && !video.paused);

        onSaveProgressRef.current();

        if (usesNativePlayer) {
          // Activity onPause already pauses native playback — avoid double-pause races.
        } else if (video && !video.paused) {
          video.pause();
        }

        if (usingHlsPlayback && !usesNativePlayer) {
          hlsRef.current?.stopLoad();
          void api.stopStream(fileId, type).catch(() => {});
        }
        return;
      }

      if (usesNativePlayer) {
        syncNativePlaybackState();
        return;
      }

      if (wasPlayingRef.current && video) {
        void video.play().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [
    enabled,
    videoRef,
    hlsRef,
    fileId,
    type,
    usingHlsPlayback,
    usesNativePlayer,
  ]);
}

export function teardownWebPlayback(
  video: HTMLVideoElement | null,
  hls: Hls | null,
  onVideoError?: () => void,
): void {
  if (video && onVideoError) {
    video.removeEventListener("error", onVideoError);
  }
  destroyHlsInstance(hls);
}
