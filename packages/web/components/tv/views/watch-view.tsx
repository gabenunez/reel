"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type Hls from "hls.js";
import { ChevronLeft, Loader2, Pause, Play, Settings2, SkipBack, SkipForward, Subtitles } from "lucide-react";
import { api, type StreamInfo, type StreamQuality } from "@/lib/api";
import { routes } from "@/lib/routes";
import {
  buildPlaybackTitle,
  getVideoBufferedRanges,
  getVideoSeekableEnd,
  PROGRESS_SAVE_MS,
  resolveInitialStreamQuality,
  resolvePlaybackStream,
  type PlaybackMediaDetail,
} from "@/lib/playback-utils";
import { destroyHlsInstance, loadHls, startWebPlayback } from "@/lib/playback-engine";
import { usePlaybackVisibility } from "@/lib/use-playback-visibility";
import { useVideoPlaybackEvents } from "@/lib/use-video-playback-events";
import { useSubtitleTracks } from "@/lib/use-subtitle-tracks";
import {
  formatSubtitleLabel,
  nextFallbackQuality,
  qualityLabel,
} from "@/lib/watch-helpers";
import { SubtitleSearchDialog } from "@/components/subtitle-search-dialog";
import { NextEpisodeCountdownOverlay } from "@/components/next-episode-countdown";
import { TvFocusButton, TvFocusLink } from "@/components/tv/tv-focus-link";
import { focusTvItem } from "@/lib/tv-focus";
import { cn, formatDuration } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/use-document-title";
import {
  nativeTvPlayerAvailable,
  pauseNativePlayback,
  registerNativePlayerHandlers,
  resumeNativePlayback,
  seekNativePlayback,
  startNativePlayback,
  stopNativePlayback,
  toAbsoluteMediaUrl,
} from "@/lib/android-bridge";
import { useNextEpisodeCountdown } from "@/lib/use-next-episode-countdown";

export function TvWatchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") ?? "movie") as "movie" | "episode";
  const fileId = parseInt(searchParams.get("id") ?? "", 10);
  const mediaId = searchParams.get("media");
  const usesNativePlayer = nativeTvPlayerAvailable();

  const videoRef = useRef<HTMLVideoElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const focusSinkRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsStartOffsetRef = useRef(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProgressRef = useRef<() => void>(() => {});
  const seekToAbsoluteRef = useRef<(seconds: number) => void>(() => {});
  const tryFallbackQualityRef = useRef<() => boolean>(() => false);
  const usingHlsRef = useRef(false);

  const TV_CONTROLS_AUTO_HIDE_MS = 3_000;

  const scheduleControlsAutoHide = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      setShowControls(false);
    }, TV_CONTROLS_AUTO_HIDE_MS);
  }, []);

  const releaseWatchFocus = useCallback(() => {
    focusSinkRef.current?.focus({ preventScroll: true });
  }, []);

  const [quality, setQuality] = useState<StreamQuality>("original");
  const [hlsStartOffset, setHlsStartOffset] = useState(0);
  const [streamStartSeconds, setStreamStartSeconds] = useState<number | null>(null);
  const [sourceDurationMs, setSourceDurationMs] = useState(0);
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [availableQualities, setAvailableQualities] = useState<StreamQuality[]>([
    "original",
    "480p",
    "720p",
    "1080p",
  ]);
  const [sourceHeight, setSourceHeight] = useState<number | null>(null);
  const [transcodingEnabled, setTranscodingEnabled] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [bufferingMidPlayback, setBufferingMidPlayback] = useState(false);
  const [bufferedRanges, setBufferedRanges] = useState<Array<{ start: number; end: number }>>(
    [],
  );
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [optimisticAbsoluteSeconds, setOptimisticAbsoluteSeconds] = useState<number | null>(
    null,
  );
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [posterPath, setPosterPath] = useState<string | null>(null);
  const [mediaDetail, setMediaDetail] = useState<PlaybackMediaDetail | null>(null);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [initialResumeSeconds, setInitialResumeSeconds] = useState<number | null>(null);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [subtitleSearchOpen, setSubtitleSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const {
    subtitles,
    activeSubtitle,
    setActiveSubtitle,
    refreshSubtitles,
    opensubtitlesConfigured,
  } = useSubtitleTracks(fileId, type, videoRef, streamGeneration);

  const playbackStream = useMemo(
    () => resolvePlaybackStream(quality, streamInfo),
    [quality, streamInfo],
  );
  const usingHlsPlayback = playbackStream.usingHls;
  usingHlsRef.current = usingHlsPlayback;
  const posterUrl = api.imageUrl(posterPath);

  const backHref =
    mediaId && !Number.isNaN(parseInt(mediaId, 10))
      ? routes.media(parseInt(mediaId, 10))
      : routes.home();

  const handlePlaybackFinished = useCallback(() => {
    router.push(backHref);
  }, [router, backHref]);

  const {
    countdown,
    countdownLabel,
    startNextEpisodeCountdown,
    cancelCountdown,
    playNextEpisodeNow,
  } = useNextEpisodeCountdown({
    type,
    fileId,
    mediaId,
    media: mediaDetail,
    onNavigate: (href) => router.push(href),
    onFinished: handlePlaybackFinished,
  });

  useEffect(() => {
    cancelCountdown();
  }, [fileId, cancelCountdown]);

  useDocumentTitle(title || null);

  const closeMenus = useCallback(() => {
    setSubtitleMenuOpen(false);
    setQualityMenuOpen(false);
    setPanelOpen(false);
  }, []);

  const revealControls = useCallback(
    (autoHide = true, focusPlay = false) => {
      setShowControls(true);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      const video = videoRef.current;
      const playing = usesNativePlayer
        ? isPlaying
        : video
          ? !video.paused
          : false;
      if (autoHide && playing && !panelOpen) {
        scheduleControlsAutoHide();
      }
      if (focusPlay) {
        requestAnimationFrame(() => {
          const play = playButtonRef.current;
          if (play) focusTvItem(play);
        });
      }
    },
    [panelOpen, usesNativePlayer, isPlaying, scheduleControlsAutoHide],
  );

  const updateBufferedPosition = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const offset = usingHlsPlayback ? hlsStartOffsetRef.current : 0;
    setBufferedRanges(
      getVideoBufferedRanges(video).map((range) => ({
        start: offset + range.start,
        end: offset + range.end,
      })),
    );
  }, [usingHlsPlayback]);

  const saveProgress = useCallback(() => {
    if (!fileId) return;

    const durationMs = Math.floor(
      sourceDurationMs || (duration ? duration * 1000 : 0),
    );
    if (!durationMs) return;

    const positionSeconds = usingHlsPlayback
      ? hlsStartOffset + currentTime
      : currentTime;

    api
      .saveProgress({
        itemType: type === "movie" ? "movie" : "episode",
        itemId: fileId,
        positionMs: Math.floor(positionSeconds * 1000),
        durationMs,
      })
      .catch(() => {});
  }, [fileId, type, usingHlsPlayback, hlsStartOffset, currentTime, sourceDurationMs, duration]);

  saveProgressRef.current = saveProgress;

  const changeQuality = useCallback(
    (nextQuality: StreamQuality) => {
      if (usesNativePlayer) {
        const absoluteTime = usingHlsPlayback
          ? hlsStartOffset + currentTime
          : currentTime;
        if (absoluteTime > 0) {
          setStreamStartSeconds(absoluteTime);
        }
      } else {
        const video = videoRef.current;
        if (video) {
          const absoluteTime = usingHlsPlayback
            ? hlsStartOffset + video.currentTime
            : video.currentTime;
          if (absoluteTime > 0) {
            setStreamStartSeconds(absoluteTime);
          }
        }
      }
      setQuality(nextQuality);
      closeMenus();
      setError(null);
      revealControls(true);
    },
    [closeMenus, revealControls, usingHlsPlayback, hlsStartOffset, usesNativePlayer, currentTime],
  );

  const tryFallbackQuality = useCallback(() => {
    const next = nextFallbackQuality(quality, availableQualities);
    if (!next || next === quality) return false;
    changeQuality(next);
    return true;
  }, [quality, availableQualities, changeQuality]);

  tryFallbackQualityRef.current = tryFallbackQuality;

  useEffect(() => {
    if (!usesNativePlayer) return;

    document.documentElement.setAttribute("data-native-video", "true");
    return registerNativePlayerHandlers({
      onState: (state) => {
        setCurrentTime(state.currentTime);
        if (state.duration > 0) setDuration(state.duration);
        setIsPlaying(state.isPlaying);
        setBuffering(state.isBuffering && !state.ready);
        setBufferingMidPlayback(state.isBuffering && state.ready);
        const offset = hlsStartOffsetRef.current;
        if (usingHlsRef.current) {
          setBufferedRanges([{ start: offset, end: offset + state.buffered }]);
        } else {
          setBufferedRanges([{ start: 0, end: state.buffered }]);
        }
      },
      onError: () => {
        setBuffering(false);
        if (tryFallbackQualityRef.current()) return;
        setError("Playback failed. Try a lower quality from the settings menu.");
      },
      onEnded: () => {
        setIsPlaying(false);
        saveProgressRef.current();
        startNextEpisodeCountdown();
      },
    });
  }, [usesNativePlayer, startNextEpisodeCountdown]);

  useEffect(() => {
    if (!usesNativePlayer) return;
    return () => {
      document.documentElement.removeAttribute("data-native-video");
      stopNativePlayback();
    };
  }, [usesNativePlayer]);

  useEffect(() => {
    setStreamStartSeconds(null);
    setStreamGeneration(0);
    setShowControls(true);
  }, [fileId, type]);

  useEffect(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (!isPlaying) {
      setShowControls(true);
      return;
    }
    if (!panelOpen) {
      scheduleControlsAutoHide();
    }
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [isPlaying, panelOpen, scheduleControlsAutoHide]);

  useEffect(() => {
    if (!fileId || Number.isNaN(fileId)) return;

    setInitialResumeSeconds(null);
    setError(null);

    api
      .getStreamInfo(fileId, type === "movie" ? "movie" : "episode")
      .then((info: StreamInfo) => {
        setStreamInfo(info);
        setAvailableQualities(info.availableQualities);
        setSourceHeight(info.height ?? null);
        setSourceDurationMs(info.durationMs ?? 0);
        setTranscodingEnabled(info.transcodingEnabled);

        const initial = resolveInitialStreamQuality(info);
        setQuality(initial.quality);
        if (initial.error) {
          setError(initial.error);
        } else {
          setError(null);
        }

        const positionMs = info.watchProgress?.positionMs ?? 0;
        const durationMs = info.watchProgress?.durationMs ?? info.durationMs ?? 0;
        if (positionMs > 0 && durationMs > 0) {
          const percent = positionMs / durationMs;
          if (percent > 0.02 && percent < 0.95) {
            setInitialResumeSeconds(positionMs / 1000);
            return;
          }
        }
        setInitialResumeSeconds(0);
      })
      .catch(() => setInitialResumeSeconds(0));
  }, [fileId, type]);

  useEffect(() => {
    if (!fileId || Number.isNaN(fileId) || !mediaId) return;

    api
      .getMedia(parseInt(mediaId, 10))
      .then((data) => {
        const media = data as unknown as PlaybackMediaDetail;
        setMediaDetail(media);
        setTitle(buildPlaybackTitle(type, media, fileId));
        if (type === "episode") {
          for (const season of media.seasons ?? []) {
            for (const episode of season.episodes ?? []) {
              if (episode.id === fileId) {
                setPosterPath(episode.stillPath ?? media.posterPath ?? null);
                return;
              }
            }
          }
        }
        setPosterPath(media.posterPath ?? null);
      })
      .catch(console.error);
  }, [mediaId, fileId, type]);

  useEffect(() => {
    if (!fileId || Number.isNaN(fileId) || initialResumeSeconds === null || !streamInfo) {
      return;
    }

    const playback = resolvePlaybackStream(quality, streamInfo);
    if (!playback.usingHls && playback.audioCompatNotice) {
      return;
    }

    const startAt = streamStartSeconds ?? initialResumeSeconds ?? 0;
    const stream = resolvePlaybackStream(quality, streamInfo);
    const usingHls = stream.usingHls;

    if (usesNativePlayer) {
      setError(null);
      setBuffering(true);
      setBufferingMidPlayback(false);

      hlsStartOffsetRef.current = usingHls ? startAt : 0;
      if (usingHls) {
        setHlsStartOffset(startAt);
      } else {
        setHlsStartOffset(0);
      }
      setCurrentTime(usingHls || startAt <= 0 ? 0 : startAt);

      const relativeUrl = api.streamUrl(
        fileId,
        type === "movie" ? "movie" : "episode",
        quality,
        usingHls ? startAt : undefined,
        streamGeneration,
        stream.hlsQuality,
      );

      startNativePlayback({
        url: toAbsoluteMediaUrl(relativeUrl),
        title: title || "MEDIA!",
        fileId,
        itemType: type === "movie" ? "movie" : "episode",
        startSeconds: usingHls ? 0 : startAt,
        durationMs: sourceDurationMs || streamInfo.durationMs || 0,
        isHls: usingHls,
        subtitleUrl:
          activeSubtitle != null
            ? toAbsoluteMediaUrl(api.subtitleUrl(activeSubtitle))
            : undefined,
      });

      progressInterval.current = setInterval(
        () => saveProgressRef.current(),
        PROGRESS_SAVE_MS,
      );

      return () => {
        if (progressInterval.current) clearInterval(progressInterval.current);
        saveProgressRef.current();
      };
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    setError(null);
    setBuffering(true);
    setBufferingMidPlayback(false);
    setBufferedRanges([]);

    if (hlsRef.current) {
      destroyHlsInstance(hlsRef.current);
      hlsRef.current = null;
    }

    video.removeAttribute("src");
    video.load();

    hlsStartOffsetRef.current = usingHls ? startAt : 0;
    if (usingHls) {
      setHlsStartOffset(startAt);
    } else {
      setHlsStartOffset(0);
    }

    video.pause();
    video.currentTime = 0;
    setCurrentTime(usingHls || startAt <= 0 ? 0 : startAt);

    const url = api.streamUrl(
      fileId,
      type === "movie" ? "movie" : "episode",
      quality,
      usingHls ? startAt : undefined,
      streamGeneration,
      stream.hlsQuality,
    );

    const onFatalError = () => {
      setBuffering(false);
      if (tryFallbackQualityRef.current()) return;
      setError("Playback failed. Try a lower quality from the settings menu.");
    };

    let cancelled = false;
    let webPlayback: ReturnType<typeof startWebPlayback> | null = null;

    void (async () => {
      const HlsConstructor = usingHls ? await loadHls() : undefined;
      if (cancelled) return;

      webPlayback = startWebPlayback({
        HlsConstructor,
        video,
        url,
        usingHls,
        startAt,
        tv: true,
        onFatalError,
        onBufferUpdate: updateBufferedPosition,
        onSeekComplete: (seconds) => setCurrentTime(seconds),
      });

      if (cancelled) {
        webPlayback.cleanup();
        return;
      }

      hlsRef.current = webPlayback.hls;
    })();

    progressInterval.current = setInterval(() => saveProgressRef.current(), PROGRESS_SAVE_MS);

    return () => {
      cancelled = true;
      webPlayback?.cleanup();
      hlsRef.current = null;
      if (progressInterval.current) clearInterval(progressInterval.current);
      saveProgressRef.current();
    };
  }, [
    fileId,
    type,
    quality,
    streamGeneration,
    streamStartSeconds,
    initialResumeSeconds,
    streamInfo,
    updateBufferedPosition,
    title,
    sourceDurationMs,
    activeSubtitle,
    usesNativePlayer,
  ]);

  useEffect(() => {
    const onPageHide = () => saveProgress();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [saveProgress]);

  const absoluteCurrentTime =
    usingHlsPlayback ? hlsStartOffsetRef.current + currentTime : currentTime;
  const absoluteDurationMs = sourceDurationMs || duration * 1000;
  const totalDurationSeconds =
    absoluteDurationMs > 0 ? absoluteDurationMs / 1000 : 0;
  const displayedAbsoluteTime =
    optimisticAbsoluteSeconds !== null ? optimisticAbsoluteSeconds : absoluteCurrentTime;
  const progress =
    absoluteDurationMs > 0 ? (displayedAbsoluteTime * 1000) / absoluteDurationMs * 100 : 0;
  const toTimelinePercent = (seconds: number) =>
    absoluteDurationMs > 0
      ? Math.min(100, Math.max(0, ((seconds * 1000) / absoluteDurationMs) * 100))
      : 0;

  const seekToAbsolute = useCallback(
    (seconds: number) => {
      if (!totalDurationSeconds) return;

      const clamped = Math.max(0, Math.min(seconds, totalDurationSeconds));
      setOptimisticAbsoluteSeconds(clamped);

      if (usesNativePlayer) {
        if (usingHlsPlayback && clamped < hlsStartOffset) {
          setStreamStartSeconds(clamped);
          setStreamGeneration((g) => g + 1);
          setBuffering(true);
          revealControls(true);
          return;
        }

        const relativeTarget = usingHlsPlayback ? clamped - hlsStartOffset : clamped;
        const bufferedEnd =
          bufferedRanges.length > 0 ? bufferedRanges[bufferedRanges.length - 1].end : 0;

        if (usingHlsPlayback && clamped > bufferedEnd + 0.5) {
          setStreamStartSeconds(clamped);
          setStreamGeneration((g) => g + 1);
          setBuffering(true);
          revealControls(true);
          return;
        }

        seekNativePlayback(relativeTarget * 1000);
        setCurrentTime(relativeTarget);
        revealControls(true);
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      if (!usingHlsPlayback) {
        video.currentTime = clamped;
        revealControls(true);
        return;
      }

      const relativeTarget = clamped - hlsStartOffset;

      if (relativeTarget < 0) {
        setStreamStartSeconds(clamped);
        setStreamGeneration((g) => g + 1);
        setBuffering(true);
        revealControls(true);
        return;
      }

      const seekableEnd = getVideoSeekableEnd(video);
      if (relativeTarget <= seekableEnd + 0.25 && video.readyState >= 1) {
        video.currentTime = relativeTarget;
        setCurrentTime(relativeTarget);
        revealControls(true);
        return;
      }

      setStreamStartSeconds(clamped);
      setStreamGeneration((g) => g + 1);
      setBuffering(true);
      revealControls(true);
    },
    [usingHlsPlayback, totalDurationSeconds, hlsStartOffset, revealControls, usesNativePlayer, bufferedRanges],
  );

  seekToAbsoluteRef.current = seekToAbsolute;

  const skipRelative = useCallback(
    (deltaSeconds: number) => {
      seekToAbsolute(
        (optimisticAbsoluteSeconds ?? absoluteCurrentTime) + deltaSeconds,
      );
    },
    [absoluteCurrentTime, optimisticAbsoluteSeconds, seekToAbsolute],
  );

  const togglePlay = useCallback(() => {
    if (usesNativePlayer) {
      if (isPlaying) {
        pauseNativePlayback();
        revealControls(false);
      } else {
        resumeNativePlayback();
        revealControls(true);
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    revealControls(!video.paused);
  }, [revealControls, usesNativePlayer, isPlaying]);

  useEffect(() => {
    setPanelOpen(subtitleMenuOpen || qualityMenuOpen);
  }, [subtitleMenuOpen, qualityMenuOpen]);

  useEffect(() => {
    if (optimisticAbsoluteSeconds === null) return;
    if (Math.abs(absoluteCurrentTime - optimisticAbsoluteSeconds) < 1.5) {
      setOptimisticAbsoluteSeconds(null);
    }
  }, [absoluteCurrentTime, optimisticAbsoluteSeconds]);

  usePlaybackVisibility({
    enabled: Boolean(fileId && !Number.isNaN(fileId)),
    videoRef,
    hlsRef,
    fileId,
    type: type === "movie" ? "movie" : "episode",
    usingHlsPlayback,
    usesNativePlayer,
    onSaveProgress: saveProgress,
  });

  useVideoPlaybackEvents({
    videoRef,
    enabled: Boolean(fileId && !Number.isNaN(fileId) && !usesNativePlayer),
    usingHlsPlayback,
    hlsStartOffset,
    optimisticAbsoluteSeconds,
    handlers: {
      onPlay: () => {
        setIsPlaying(true);
        revealControls(true);
      },
      onPause: () => {
        setIsPlaying(false);
        revealControls(false);
      },
      onSaveProgress: saveProgress,
      onBufferUpdate: updateBufferedPosition,
      onEnded: () => {
        setIsPlaying(false);
        startNextEpisodeCountdown();
      },
      onCurrentTime: setCurrentTime,
      onDuration: setDuration,
      onBuffering: (nextBuffering, midPlayback) => {
        setBuffering(nextBuffering);
        setBufferingMidPlayback(midPlayback);
      },
      onSeekResolved: (actual) => {
        if (optimisticAbsoluteSeconds === null) return;
        if (Math.abs(actual - optimisticAbsoluteSeconds) < 1.5) {
          setOptimisticAbsoluteSeconds(null);
        }
      },
    },
  });

  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!countdown) return;
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>(
        "[data-tv-watch-next-episode] [data-tv-item]",
      );
      if (first) focusTvItem(first);
    });
  }, [countdown]);

  useEffect(() => {
    if (!subtitleMenuOpen && !qualityMenuOpen) return;
    requestAnimationFrame(() => {
      const panel = document.querySelector("[data-tv-watch-menu]");
      const first = panel?.querySelector<HTMLElement>("[data-tv-item]");
      if (first) focusTvItem(first);
    });
  }, [subtitleMenuOpen, qualityMenuOpen]);

  useEffect(() => {
    if (!subtitleSearchOpen) return;
    requestAnimationFrame(() => {
      const panel = document.querySelector("[data-tv-watch-menu]");
      const first = panel?.querySelector<HTMLElement>("[data-tv-item]");
      if (first) focusTvItem(first);
    });
  }, [subtitleSearchOpen]);

  useEffect(() => {
    if (!error) return;
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>("[data-tv-watch-error] [data-tv-item]");
      if (first) focusTvItem(first);
    });
  }, [error]);

  const isPreparing = initialResumeSeconds === null;
  const showLoadingOverlay =
    (isPreparing || buffering) &&
    !error &&
    !(!usingHlsPlayback && optimisticAbsoluteSeconds !== null);
  const loadingMessage = isPreparing
    ? "Preparing playback..."
    : bufferingMidPlayback
      ? "Buffering..."
      : usingHlsPlayback && quality === "original"
        ? "Preparing original stream..."
        : usingHlsPlayback
          ? `Starting ${(playbackStream.hlsQuality ?? quality).toUpperCase()} stream...`
          : "Loading video...";
  const controlsVisible = showControls || panelOpen;

  const controlButtonClassName =
    "tv-watch-control flex items-center justify-center rounded-lg text-white";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;

      if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack") {
        if (countdown) {
          e.preventDefault();
          cancelCountdown();
          router.push(backHref);
          return;
        }
        if (panelOpen || subtitleSearchOpen) {
          e.preventDefault();
          if (subtitleSearchOpen) {
            setSubtitleSearchOpen(false);
          } else {
            closeMenus();
          }
          revealControls(false);
          return;
        }
        e.preventDefault();
        router.push(backHref);
        return;
      }

      if (subtitleSearchOpen) return;

      if (panelOpen) return;

      if (
        e.key === "Enter" ||
        e.key === "NumpadEnter" ||
        e.key === "Select"
      ) {
        if (active?.hasAttribute("data-tv-item")) return;
        e.preventDefault();
        togglePlay();
        return;
      }

      if (active?.hasAttribute("data-tv-watch-scrub")) {
        if (e.key === "ArrowLeft" || e.key === "MediaRewind") {
          e.preventDefault();
          skipRelative(-30);
          return;
        }
        if (e.key === "ArrowRight" || e.key === "MediaFastForward") {
          e.preventDefault();
          skipRelative(30);
          return;
        }
      }

      if (e.code === "Space" || e.key === "MediaPlayPause") {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (controlsVisible) {
          setShowControls(false);
          closeMenus();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        revealControls(false, true);
        return;
      }

      if (active?.closest("[data-tv-watch-controls]")) return;

      if (e.key === "ArrowRight" || e.key === "MediaFastForward") {
        e.preventDefault();
        skipRelative(10);
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "MediaRewind") {
        e.preventDefault();
        skipRelative(-10);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    togglePlay,
    skipRelative,
    router,
    backHref,
    panelOpen,
    subtitleSearchOpen,
    closeMenus,
    revealControls,
    controlsVisible,
    countdown,
    cancelCountdown,
  ]);

  useEffect(() => {
    if (!controlsVisible && !panelOpen) {
      releaseWatchFocus();
    }
  }, [controlsVisible, panelOpen, releaseWatchFocus]);

  if (!fileId || Number.isNaN(fileId)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="text-center">
          <p className="mb-4 text-muted-foreground">Invalid playback URL</p>
          <TvFocusLink
            href={routes.home()}
            className="inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
          >
            Go home
          </TvFocusLink>
        </div>
      </div>
    );
  }

  return (
    <div
      data-tv-watch-player=""
      data-native-video={usesNativePlayer ? "" : undefined}
      className={cn("fixed inset-0 z-40", usesNativePlayer ? "bg-transparent" : "bg-black")}
      onMouseMove={() => revealControls(true)}
      onClick={() => revealControls(true)}
    >
      <div
        ref={focusSinkRef}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0 outline-none focus:outline-none"
      />
      {!usesNativePlayer && (
      <video
        ref={videoRef}
        tabIndex={-1}
        className="media-subtitles absolute inset-0 h-full w-full object-contain outline-none focus:outline-none"
        controls={false}
        playsInline
        poster={posterUrl ?? undefined}
        preload={streamInfo ? "auto" : "metadata"}
        onClick={(e) => {
          e.stopPropagation();
          if (panelOpen) {
            closeMenus();
            return;
          }
          togglePlay();
        }}
      />
      )}

      {showLoadingOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-background/80 px-5 py-4 text-lg text-white">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            {loadingMessage}
          </div>
        </div>
      )}

      {countdown && countdownLabel && (
        <NextEpisodeCountdownOverlay
          countdown={countdown}
          label={countdownLabel}
          tv
          onCancel={() => {
            cancelCountdown();
            router.push(backHref);
          }}
          onPlayNow={playNextEpisodeNow}
        />
      )}

      {error && (
        <div
          data-tv-watch-error=""
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 px-8"
        >
          <div className="max-w-lg text-center">
            <p className="mb-6 text-lg text-red-400">{error}</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {transcodingEnabled &&
                nextFallbackQuality(quality, availableQualities) && (
                  <TvFocusButton
                    onClick={() => {
                      const next = nextFallbackQuality(quality, availableQualities);
                      if (next) changeQuality(next);
                    }}
                    className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
                  >
                    Try {qualityLabel(nextFallbackQuality(quality, availableQualities)!, sourceHeight)}
                  </TvFocusButton>
                )}
              <TvFocusLink
                href={backHref}
                className="inline-flex rounded-xl border border-white/20 px-6 py-3 font-semibold text-white"
              >
                Go back
              </TvFocusLink>
            </div>
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col justify-between transition-opacity duration-300 pointer-events-none",
          controlsVisible ? "opacity-100" : "opacity-0",
        )}
        {...(!controlsVisible && !panelOpen ? { inert: true } : {})}
      >
        <div className="pointer-events-auto bg-gradient-to-b from-black/85 to-transparent px-6 pb-6 pt-6">
          <div
            data-tv-row=""
            data-tv-content-row=""
            data-tv-watch-controls=""
            className="flex items-center gap-3 py-1"
          >
            <TvFocusLink
              href={backHref}
              variant="nav"
              className={cn("h-11 w-11 backdrop-blur", controlButtonClassName)}
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </TvFocusLink>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-white">{title || "Playing"}</p>
              <p className="text-xs text-white/70">
                {qualityLabel(quality, sourceHeight)}
                {activeSubtitle !== null && " · Subtitles on"}
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 pb-6 pt-10">
          <div
            data-tv-row=""
            data-tv-content-row=""
            data-tv-watch-controls=""
            className="mb-3 py-1"
          >
            <TvFocusButton
              variant="nav"
              data-tv-watch-scrub=""
              aria-label="Progress"
              onClick={() => revealControls(false)}
              className="relative h-2 w-full overflow-visible rounded-full bg-white/20 p-0"
            >
              {bufferedRanges.map((range, index) => {
                const left = toTimelinePercent(range.start);
                const width = Math.max(0, toTimelinePercent(range.end) - left);
                if (width <= 0) return null;
                return (
                  <div
                    key={index}
                    className="pointer-events-none absolute inset-y-0 rounded-full bg-white/45"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                );
              })}
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 bg-primary",
                  progress >= 99.5 ? "rounded-full" : "rounded-l-full",
                  optimisticAbsoluteSeconds === null && "transition-[width] duration-150",
                )}
                style={{ width: `${Math.min(100, progress)}%` }}
              />
              <div
                className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
                style={{ left: `${Math.min(100, progress)}%` }}
              />
            </TvFocusButton>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div
              data-tv-row=""
              data-tv-content-row=""
              data-tv-watch-controls=""
              className="flex items-center gap-3 py-1"
            >
              <TvFocusButton
                variant="nav"
                onClick={() => skipRelative(-10)}
                aria-label="Back 10 seconds"
                className={cn("h-11 w-11", controlButtonClassName)}
              >
                <SkipBack className="h-5 w-5" />
              </TvFocusButton>

              <TvFocusButton
                ref={playButtonRef}
                variant="nav"
                onClick={togglePlay}
                className={cn("h-11 w-11", controlButtonClassName)}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 fill-current" />
                )}
              </TvFocusButton>

              <TvFocusButton
                variant="nav"
                onClick={() => skipRelative(30)}
                aria-label="Forward 30 seconds"
                className={cn("h-11 w-11", controlButtonClassName)}
              >
                <SkipForward className="h-5 w-5" />
              </TvFocusButton>

              <TvFocusButton
                variant="nav"
                onClick={() => {
                  setQualityMenuOpen(false);
                  setSubtitleMenuOpen((open) => !open);
                  revealControls(false);
                }}
                className={cn(
                  "h-11 gap-2 px-3",
                  controlButtonClassName,
                  activeSubtitle !== null && "text-primary",
                )}
              >
                <Subtitles className="h-4 w-4" />
                <span className="text-xs font-medium">Subs</span>
              </TvFocusButton>

              <TvFocusButton
                variant="nav"
                onClick={() => {
                  setSubtitleMenuOpen(false);
                  setQualityMenuOpen((open) => !open);
                  revealControls(false);
                }}
                disabled={!transcodingEnabled && quality === "original"}
                className={cn("h-11 gap-2 px-3", controlButtonClassName)}
              >
                <Settings2 className="h-4 w-4" />
                <span className="text-xs font-medium">Quality</span>
              </TvFocusButton>
            </div>

            <span className="font-mono text-sm tabular-nums text-white">
              {formatDuration(displayedAbsoluteTime * 1000)}
              {totalDurationSeconds > 0 && (
                <> / {formatDuration(totalDurationSeconds * 1000)}</>
              )}
            </span>
          </div>
        </div>
      </div>

      {subtitleMenuOpen && (
        <div
          data-tv-watch-menu=""
          className="absolute inset-x-0 bottom-0 z-40 max-h-[50vh] overflow-y-auto border-t border-white/10 bg-background/95 px-6 py-4 backdrop-blur-xl"
        >
          <h2 className="mb-3 text-base font-bold text-white">Subtitles</h2>
          <div
            data-tv-row=""
            data-tv-content-row=""
            data-tv-vertical=""
            className="flex flex-col gap-1.5"
          >
            <TvFocusButton
              variant="card"
              selected={activeSubtitle === null}
              onClick={() => {
                setActiveSubtitle(null);
                closeMenus();
              }}
              className="rounded-xl px-4 py-3 text-left text-base"
            >
              Off
            </TvFocusButton>
            {subtitles.map((sub) => (
              <TvFocusButton
                key={sub.id}
                variant="card"
                selected={activeSubtitle === sub.id}
                onClick={() => {
                  setActiveSubtitle(sub.id);
                  closeMenus();
                }}
                className="rounded-xl px-4 py-3 text-left text-base"
              >
                {formatSubtitleLabel(sub)}
              </TvFocusButton>
            ))}
            {opensubtitlesConfigured && (
              <TvFocusButton
                variant="card"
                onClick={() => {
                  closeMenus();
                  setSubtitleSearchOpen(true);
                }}
                className="rounded-xl bg-muted/40 px-4 py-3 text-left text-base text-primary"
              >
                Search online...
              </TvFocusButton>
            )}
            {subtitles.length === 0 && !opensubtitlesConfigured && (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                No subtitles found. Configure OpenSubtitles on the desktop site to search online.
              </p>
            )}
          </div>
        </div>
      )}

      {qualityMenuOpen && (
        <div
          data-tv-watch-menu=""
          className="absolute inset-x-0 bottom-0 z-40 border-t border-white/10 bg-background/95 px-6 py-4 backdrop-blur-xl"
        >
          <h2 className="mb-3 text-base font-bold text-white">Quality</h2>
          <div
            data-tv-row=""
            data-tv-content-row=""
            data-tv-vertical=""
            className="flex flex-col gap-1.5"
          >
            {availableQualities.map((option) => (
              <TvFocusButton
                key={option}
                variant="card"
                selected={quality === option}
                disabled={option !== "original" && !transcodingEnabled}
                onClick={() => changeQuality(option)}
                className="rounded-xl px-4 py-3 text-left text-base disabled:opacity-40"
              >
                {qualityLabel(option, sourceHeight)}
              </TvFocusButton>
            ))}
          </div>
        </div>
      )}

      <SubtitleSearchDialog
        tv
        open={subtitleSearchOpen}
        onClose={() => setSubtitleSearchOpen(false)}
        fileId={fileId}
        type={type}
        opensubtitlesConfigured={opensubtitlesConfigured}
        onDownloaded={(track) => {
          setActiveSubtitle(track.id);
          closeMenus();
          void refreshSubtitles(track);
        }}
      />
    </div>
  );
}
