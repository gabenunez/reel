"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Hls from "hls.js";
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
  startDirectPlaybackWithResume,
  type PlaybackMediaDetail,
} from "@/lib/playback-utils";
import { useSubtitleTracks } from "@/lib/use-subtitle-tracks";
import {
  formatSubtitleLabel,
  nextFallbackQuality,
  qualityLabel,
} from "@/lib/watch-helpers";
import { SubtitleSearchDialog } from "@/components/subtitle-search-dialog";
import { TvFocusButton, TvFocusLink } from "@/components/tv/tv-focus-link";
import { focusTvItem } from "@/lib/tv-focus";
import { cn, formatDuration } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/use-document-title";

export function TvWatchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") ?? "movie") as "movie" | "episode";
  const fileId = parseInt(searchParams.get("id") ?? "", 10);
  const mediaId = searchParams.get("media");

  const videoRef = useRef<HTMLVideoElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsStartOffsetRef = useRef(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProgressRef = useRef<() => void>(() => {});
  const seekToAbsoluteRef = useRef<(seconds: number) => void>(() => {});
  const tryFallbackQualityRef = useRef<() => boolean>(() => false);

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

  const backHref =
    mediaId && !Number.isNaN(parseInt(mediaId, 10))
      ? routes.media(parseInt(mediaId, 10))
      : routes.home();

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
      if (autoHide && video && !video.paused && !panelOpen) {
        hideControlsTimer.current = setTimeout(() => setShowControls(false), 6000);
      }
      if (focusPlay) {
        requestAnimationFrame(() => {
          const play = playButtonRef.current;
          if (play) focusTvItem(play);
        });
      }
    },
    [panelOpen],
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
    const video = videoRef.current;
    if (!video || !fileId) return;

    const durationMs = Math.floor(
      sourceDurationMs || (video.duration ? video.duration * 1000 : 0),
    );
    if (!durationMs) return;

    const positionSeconds = usingHlsPlayback
      ? hlsStartOffset + video.currentTime
      : video.currentTime;

    api
      .saveProgress({
        itemType: type === "movie" ? "movie" : "episode",
        itemId: fileId,
        positionMs: Math.floor(positionSeconds * 1000),
        durationMs,
      })
      .catch(() => {});
  }, [fileId, type, usingHlsPlayback, hlsStartOffset, sourceDurationMs]);

  saveProgressRef.current = saveProgress;

  const changeQuality = useCallback(
    (nextQuality: StreamQuality) => {
      const video = videoRef.current;
      if (video) {
        const absoluteTime = usingHlsPlayback
          ? hlsStartOffset + video.currentTime
          : video.currentTime;
        if (absoluteTime > 0) {
          setStreamStartSeconds(absoluteTime);
        }
      }
      setQuality(nextQuality);
      closeMenus();
      setError(null);
      revealControls(true);
    },
    [closeMenus, revealControls, usingHlsPlayback, hlsStartOffset],
  );

  const tryFallbackQuality = useCallback(() => {
    const next = nextFallbackQuality(quality, availableQualities);
    if (!next || next === quality) return false;
    changeQuality(next);
    return true;
  }, [quality, availableQualities, changeQuality]);

  tryFallbackQualityRef.current = tryFallbackQuality;

  useEffect(() => {
    setStreamStartSeconds(null);
    setStreamGeneration(0);
  }, [fileId, type]);

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
        setTitle(buildPlaybackTitle(type, media, fileId));
      })
      .catch(console.error);
  }, [mediaId, fileId, type]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !fileId || Number.isNaN(fileId) || initialResumeSeconds === null || !streamInfo) {
      return;
    }

    const playback = resolvePlaybackStream(quality, streamInfo);
    if (!playback.usingHls && playback.audioCompatNotice) {
      return;
    }

    setError(null);
    setBuffering(true);
    setBufferingMidPlayback(false);
    setBufferedRanges([]);

    if (hlsRef.current) {
      hlsRef.current.stopLoad();
      hlsRef.current.detachMedia();
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.removeAttribute("src");
    video.load();

    const startAt = streamStartSeconds ?? initialResumeSeconds ?? 0;
    const stream = resolvePlaybackStream(quality, streamInfo);
    const usingHls = stream.usingHls;

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

    let stopDirectPlayback: (() => void) | null = null;

    const onVideoError = () => {
      setBuffering(false);
      if (tryFallbackQualityRef.current()) return;
      setError("Playback failed. Try a lower quality from the settings menu.");
    };

    if (usingHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({ backBufferLength: 90, maxBufferHole: 0.5, nudgeOnVideoHole: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          hls.startLoad(0);
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setBuffering(false);
            if (tryFallbackQualityRef.current()) return;
            setError("Playback failed. Try a lower quality from the settings menu.");
          }
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => updateBufferedPosition());
        hls.on(Hls.Events.BUFFER_APPENDED, () => updateBufferedPosition());
        hlsRef.current = hls;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener("error", onVideoError);
        video.play().catch(() => {});
      } else {
        setBuffering(false);
        if (tryFallbackQualityRef.current()) return;
        setError("HLS not supported on this device");
      }
    } else {
      video.src = url;
      video.addEventListener("error", onVideoError);
      stopDirectPlayback = startDirectPlaybackWithResume(video, startAt, {
        onSeekComplete: (seconds) => setCurrentTime(seconds),
      });
    }

    progressInterval.current = setInterval(() => saveProgressRef.current(), PROGRESS_SAVE_MS);

    return () => {
      video.removeEventListener("error", onVideoError);
      stopDirectPlayback?.();
      if (hlsRef.current) hlsRef.current.destroy();
      if (progressInterval.current) clearInterval(progressInterval.current);
      saveProgressRef.current();
    };
  }, [fileId, type, quality, streamGeneration, streamStartSeconds, initialResumeSeconds, streamInfo, updateBufferedPosition]);

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
      const video = videoRef.current;
      if (!video || !totalDurationSeconds) return;

      const clamped = Math.max(0, Math.min(seconds, totalDurationSeconds));
      setOptimisticAbsoluteSeconds(clamped);

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
    [usingHlsPlayback, totalDurationSeconds, hlsStartOffset, revealControls],
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
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    revealControls(!video.paused);
  }, [revealControls]);

  useEffect(() => {
    setPanelOpen(subtitleMenuOpen || qualityMenuOpen);
  }, [subtitleMenuOpen, qualityMenuOpen]);

  useEffect(() => {
    if (optimisticAbsoluteSeconds === null) return;
    if (Math.abs(absoluteCurrentTime - optimisticAbsoluteSeconds) < 1.5) {
      setOptimisticAbsoluteSeconds(null);
    }
  }, [absoluteCurrentTime, optimisticAbsoluteSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
      revealControls(true);
    };
    const onPause = () => {
      setIsPlaying(false);
      revealControls(false);
      saveProgress();
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      updateBufferedPosition();
    };
    const onDurationChange = () => setDuration(video.duration || 0);
    const onLoadedMetadata = () => setDuration(video.duration || 0);
    const onProgress = () => updateBufferedPosition();
    const onWaiting = () => {
      setBuffering(true);
      setBufferingMidPlayback(true);
    };
    const onPlaying = () => {
      setBuffering(false);
      setBufferingMidPlayback(false);
      updateBufferedPosition();
    };
    const onCanPlay = () => updateBufferedPosition();
    const onSeeked = () => {
      if (optimisticAbsoluteSeconds === null) return;
      const actual = usingHlsPlayback
        ? hlsStartOffset + video.currentTime
        : video.currentTime;
      if (Math.abs(actual - optimisticAbsoluteSeconds) < 1.5) {
        setOptimisticAbsoluteSeconds(null);
      }
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
    };
  }, [
    revealControls,
    saveProgress,
    updateBufferedPosition,
    optimisticAbsoluteSeconds,
    usingHlsPlayback,
    hlsStartOffset,
  ]);

  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

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
  const controlsVisible = showControls || panelOpen || !isPlaying;

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
        if (controlsVisible) {
          e.preventDefault();
          setShowControls(false);
          closeMenus();
          active?.blur();
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
  ]);

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
      className="fixed inset-0 z-40 bg-black"
      onMouseMove={() => revealControls(true)}
      onClick={() => revealControls(true)}
    >
      <video
        ref={videoRef}
        className="reel-subtitles absolute inset-0 h-full w-full object-contain"
        controls={false}
        playsInline
        preload="auto"
        onClick={(e) => {
          e.stopPropagation();
          if (panelOpen) {
            closeMenus();
            return;
          }
          togglePlay();
        }}
      />

      {showLoadingOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-background/80 px-5 py-4 text-lg text-white">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            {loadingMessage}
          </div>
        </div>
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
              className="relative h-3 w-full overflow-hidden rounded-full bg-white/20 p-0"
            >
              {bufferedRanges.map((range, index) => {
                const left = toTimelinePercent(range.start);
                const width = Math.max(0, toTimelinePercent(range.end) - left);
                if (width <= 0) return null;
                return (
                  <div
                    key={index}
                    className="pointer-events-none absolute inset-y-0 bg-white/45"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                );
              })}
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary",
                  optimisticAbsoluteSeconds === null && "transition-[width] duration-150",
                )}
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </TvFocusButton>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div
              data-tv-row=""
              data-tv-content-row=""
              data-tv-watch-controls=""
              className="flex items-center gap-2 py-1"
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
