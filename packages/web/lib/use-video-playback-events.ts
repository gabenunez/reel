"use client";

import { useEffect, useRef } from "react";

const TIMEUPDATE_THROTTLE_MS = 250;

export interface VideoPlaybackEventHandlers {
  onPlay: () => void;
  onPause: () => void;
  onSaveProgress: () => void;
  onBufferUpdate: () => void;
  onEnded: () => void;
  onCurrentTime: (seconds: number) => void;
  onDuration: (seconds: number) => void;
  onBuffering: (buffering: boolean, midPlayback: boolean) => void;
  onSeekResolved: (actualSeconds: number) => void;
}

interface UseVideoPlaybackEventsOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  usingHlsPlayback: boolean;
  hlsStartOffset: number;
  optimisticAbsoluteSeconds: number | null;
  handlers: VideoPlaybackEventHandlers;
}

export function useVideoPlaybackEvents(options: UseVideoPlaybackEventsOptions): void {
  const {
    videoRef,
    enabled,
    usingHlsPlayback,
    hlsStartOffset,
    optimisticAbsoluteSeconds,
    handlers,
  } = options;

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const optimisticRef = useRef(optimisticAbsoluteSeconds);
  optimisticRef.current = optimisticAbsoluteSeconds;

  useEffect(() => {
    if (!enabled) return;

    const video = videoRef.current;
    if (!video) return;

    let lastTimeUpdate = 0;

    const onPlay = () => handlersRef.current.onPlay();
    const onPause = () => {
      handlersRef.current.onPause();
      handlersRef.current.onSaveProgress();
    };
    const onTimeUpdate = () => {
      const now = performance.now();
      if (now - lastTimeUpdate < TIMEUPDATE_THROTTLE_MS) return;
      lastTimeUpdate = now;
      handlersRef.current.onCurrentTime(video.currentTime);
      handlersRef.current.onBufferUpdate();
    };
    const onDurationChange = () =>
      handlersRef.current.onDuration(video.duration || 0);
    const onLoadedMetadata = () =>
      handlersRef.current.onDuration(video.duration || 0);
    const onProgress = () => handlersRef.current.onBufferUpdate();
    const onWaiting = () => handlersRef.current.onBuffering(true, true);
    const onPlaying = () => {
      handlersRef.current.onBuffering(false, false);
      handlersRef.current.onBufferUpdate();
    };
    const onCanPlay = () => {
      handlersRef.current.onBuffering(false, false);
      handlersRef.current.onBufferUpdate();
    };
    const onSeeked = () => {
      if (optimisticRef.current === null) return;
      const actual = usingHlsPlayback
        ? hlsStartOffset + video.currentTime
        : video.currentTime;
      handlersRef.current.onSeekResolved(actual);
    };
    const onEnded = () => {
      handlersRef.current.onEnded();
      handlersRef.current.onSaveProgress();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("progress", onProgress);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
    };
  }, [enabled, videoRef, usingHlsPlayback, hlsStartOffset]);
}
