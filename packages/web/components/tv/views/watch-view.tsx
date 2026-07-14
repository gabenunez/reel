"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWatchRouteParams } from "@/lib/use-route-params";
import { useIsClient } from "@/lib/use-browser-pathname";
import type Hls from "hls.js";
import { Loader2, Pause, Play, Settings2, SkipBack, SkipForward, Subtitles } from "lucide-react";
import { api, type StreamInfo, type StreamQuality } from "@/lib/api";
import { routes } from "@/lib/routes";
import {
  buildPlaybackTitle,
  getVideoBufferedRanges,
  getScrubberBufferedRanges,
  getVideoSeekableEnd,
  isSpuriousHlsEnded,
  resolveSpuriousRecovery,
  type SpuriousRecoveryState,
  SPURIOUS_RECOVERY_PROGRESS_SECONDS,
  PROGRESS_SAVE_MS,
  getPlaybackRestartSeconds,
  nextStableAbsoluteSeconds,
  resolvePlaybackStartSeconds,
  resolveInitialStreamQuality,
  resolvePlaybackStream,
  type PlaybackMediaDetail,
} from "@/lib/playback-utils";
import { destroyHlsInstance, loadHls, catchUpHlsPlayback, recoverHlsPlaybackAtPlaylistEnd, startWebPlayback } from "@/lib/playback-engine";
import { notifyWebPlaybackSourceReady } from "@/lib/web-subtitle-attach";
import { usePlaybackVisibility } from "@/lib/use-playback-visibility";
import { useVideoPlaybackEvents } from "@/lib/use-video-playback-events";
import { useSubtitleTracks } from "@/lib/use-subtitle-tracks";
import { resolveWebSubtitlePlaybackSeconds } from "@/lib/subtitle-timeline";
import { WebSubtitleCueOverlay } from "@/components/web-subtitle-cue-overlay";
import { SubtitleLoadNotice } from "@/components/subtitle-load-notice";
import {
  formatSubtitleLabel,
  qualityLabel,
  resolveFallbackQuality,
} from "@/lib/watch-helpers";
import { is4KSource, isHlsVideoCopySupported, needsHdrToneMap } from "@media-app/shared";
import { SubtitleSearchDialog } from "@/components/subtitle-search-dialog";
import { TvSubtitleAppearancePanel } from "@/components/subtitle-style-settings";
import { NextEpisodeCountdownOverlay } from "@/components/next-episode-countdown";
import { PlaybackPosterBackdrop } from "@/components/playback-poster-backdrop";
import { SeekPreviewTooltip } from "@/components/seek-preview-tooltip";
import { TvFocusButton, TvFocusLink } from "@/components/tv/tv-focus-link";
import {
  TvWatchMenuList,
  TvWatchPopover,
  tvWatchPopoverOptionClassName,
} from "@/components/tv/tv-watch-settings-menu";
import { focusFirstWatchMenuItem, focusTvItem } from "@/lib/tv-focus";
import { needsTvSdUpscaleSoftening, tvImageUrl } from "@/lib/tv-image";
import { isTv4KClient } from "@/lib/tv-mode-detect";
import { cn, formatDuration } from "@/lib/utils";
import { formatDynamicRangeChromeSuffix } from "@media-app/shared";
import { useDocumentTitle } from "@/lib/use-document-title";
import {
  nativeTvPlayerAvailable,
  pauseNativePlayback,
  prepareNativeVideoOverlay,
  registerNativePlayerHandlers,
  registerWatchBackHandler,
  resumeNativePlayback,
  seekNativePlayback,
  startNativePlayback,
  stopNativePlayback,
  setNativeVideoDisplayMode,
  syncNativePlaybackState,
  setNativeWebOverlayAlpha,
  toAbsoluteMediaUrl,
  updateNativeSubtitles,
} from "@/lib/android-bridge";
import {
  applySubtitleStyles,
  readSubtitleStyles,
} from "@/lib/subtitle-styles";
import { useMarkTvBootReadyWhen } from "@/components/tv/tv-boot-ready";
import { useNextEpisodeCountdown } from "@/lib/use-next-episode-countdown";
import { useSeekThumbnails } from "@/lib/use-seek-thumbnails";
import { VideoDisplayModeButton } from "@/components/video-display-mode-button";
import {
  cycleVideoDisplayMode,
  loadVideoDisplayMode,
  saveVideoDisplayMode,
  videoDisplayModeClass,
  type VideoDisplayMode,
} from "@/lib/video-display-mode";

function TvWatchScrubTrack({
  bufferedRanges,
  progress,
  previewPercent,
  bufferingMidPlayback,
  toTimelinePercent,
  optimisticSeek,
}: {
  bufferedRanges: Array<{ start: number; end: number }>;
  progress: number;
  previewPercent?: number | null;
  bufferingMidPlayback: boolean;
  toTimelinePercent: (seconds: number) => number;
  optimisticSeek: boolean;
}) {
  const progressClamped = Math.min(100, Math.max(0, progress));
  const previewClamped =
    previewPercent === null || previewPercent === undefined
      ? null
      : Math.min(100, Math.max(0, previewPercent));
  const bufferEndSeconds = bufferedRanges.reduce(
    (max, range) => Math.max(max, range.end),
    0,
  );
  const bufferEndPercent = toTimelinePercent(bufferEndSeconds);
  const aheadWidth = Math.max(0, bufferEndPercent - progressClamped);

  return (
    <div
      className={cn(
        "watch-scrub-track absolute inset-x-0 top-1/2 w-full -translate-y-1/2",
        bufferingMidPlayback && "watch-scrub-track--buffering",
      )}
    >
      {bufferedRanges.map((range, index) => {
        const left = toTimelinePercent(range.start);
        const width = Math.max(0, toTimelinePercent(range.end) - left);
        if (width <= 0) return null;
        return (
          <div
            key={index}
            className={cn(
              "watch-scrub-buffer",
              bufferingMidPlayback && "watch-scrub-buffer--active",
            )}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
      {bufferingMidPlayback && aheadWidth > 0.3 && (
        <div
          className="watch-scrub-buffer-ahead"
          style={{ left: `${progressClamped}%`, width: `${aheadWidth}%` }}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          "watch-scrub-progress",
          progressClamped >= 99.5 ? "rounded-full" : "rounded-l-full",
          !optimisticSeek && "transition-[width] duration-150",
          bufferingMidPlayback && "watch-scrub-progress--buffering",
        )}
        style={{ width: `${progressClamped}%` }}
      />
      <div
        className={cn(
          "watch-scrub-playhead",
          bufferingMidPlayback && "watch-scrub-playhead--buffering",
        )}
        style={{ left: `${progressClamped}%` }}
      />
      {previewClamped !== null &&
        Math.abs(previewClamped - progressClamped) > 0.05 && (
          <div
            className="watch-scrub-playhead watch-scrub-hover-playhead"
            style={{ left: `${previewClamped}%` }}
          />
        )}
    </div>
  );
}

export function TvWatchView() {
  const isClient = useIsClient();
  const router = useRouter();
  const { type, fileId, mediaId } = useWatchRouteParams();
  const usesNativePlayer = nativeTvPlayerAvailable();

  const videoRef = useRef<HTMLVideoElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const scrubButtonRef = useRef<HTMLButtonElement>(null);
  const focusSinkRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsStartOffsetRef = useRef(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProgressRef = useRef<() => void>(() => {});
  const seekToAbsoluteRef = useRef<(seconds: number) => void>(() => {});
  const tryFallbackQualityRef = useRef<() => boolean>(() => false);
  const usingHlsRef = useRef(false);
  const wasUsingHlsRef = useRef(false);
  const lastStableAbsoluteSecondsRef = useRef(0);
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef(0);
  const currentTimeRef = useRef(0);
  const nativeSubtitlesSyncedSessionRef = useRef(-1);
  const activeSubtitleRef = useRef<number | null>(null);
  const streamInfoRef = useRef<StreamInfo | null>(null);
  const titleRef = useRef("");
  const playbackStreamRef = useRef<ReturnType<typeof resolvePlaybackStream> | null>(null);
  const playbackFatalHandledRef = useRef(-1);
  const spuriousRecoveryStateRef = useRef<SpuriousRecoveryState>({
    attempts: 0,
    lastEndedAtMs: 0,
    anchorSeconds: 0,
  });
  const nativePlaySessionRef = useRef(0);
  const nativeErrorHandledSessionRef = useRef(0);
  const nativeWasPlayingRef = useRef(false);
  const nativeIsPlayingRef = useRef(false);
  const nativePausedAtRef = useRef<number | null>(null);
  const nativeHlsRecoveryAttemptsRef = useRef(0);
  const startNextEpisodeCountdownRef = useRef<() => void>(() => {});
  const controlsRevealedAtRef = useRef<number | null>(null);

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
  const pendingStreamStartRef = useRef<number | null>(null);
  const [sourceDurationMs, setSourceDurationMs] = useState(0);
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [forceRemux, setForceRemux] = useState(false);
  const nativeRemuxFallbackRef = useRef(false);
  const nativeTranscodeFallbackRef = useRef(false);
  const [availableQualities, setAvailableQualities] = useState<StreamQuality[]>([
    "original",
    "480p",
    "720p",
    "1080p",
  ]);
  const [sourceHeight, setSourceHeight] = useState<number | null>(null);
  const [sourceWidth, setSourceWidth] = useState<number | null>(null);
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
  const [subtitleAppearanceOpen, setSubtitleAppearanceOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [subtitleSearchOpen, setSubtitleSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [playbackHasBegun, setPlaybackHasBegun] = useState(false);
  const [scrubPreview, setScrubPreview] = useState<number | null>(null);
  const scrubPreviewRef = useRef<number | null>(null);
  useEffect(() => {
    scrubPreviewRef.current = scrubPreview;
  }, [scrubPreview]);
  const [videoDisplayMode, setVideoDisplayMode] = useState<VideoDisplayMode>("fit");

  useEffect(() => {
    setVideoDisplayMode(loadVideoDisplayMode());
  }, []);

  const cycleVideoDisplayModeSetting = useCallback(() => {
    setVideoDisplayMode((current) => {
      const next = cycleVideoDisplayMode(current);
      saveVideoDisplayMode(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!usesNativePlayer) return;
    setNativeVideoDisplayMode(videoDisplayMode);
  }, [usesNativePlayer, videoDisplayMode]);

  const { thumbnails, lookupCue } = useSeekThumbnails(
    fileId,
    type === "movie" ? "movie" : "episode",
    Boolean(fileId && !Number.isNaN(fileId)),
  );

  const playbackStream = useMemo(
    () => resolvePlaybackStream(quality, streamInfo, { forceRemux }),
    [quality, streamInfo, forceRemux],
  );
  const usingHlsPlayback = playbackStream.usingHls;
  usingHlsRef.current = usingHlsPlayback;
  playbackStreamRef.current = playbackStream;
  titleRef.current = title;
  streamInfoRef.current = streamInfo;

  const getSubtitlePlaybackSeconds = useCallback(() => {
    const video = videoRef.current;
    if (!video) return 0;
    return resolveWebSubtitlePlaybackSeconds({
      usingHlsPlayback,
      videoCurrentTime: video.currentTime,
      streamStartSeconds: pendingStreamStartRef.current,
      hlsStartOffsetLive: hlsStartOffsetRef.current,
      hlsStartOffset,
      initialResumeSeconds,
      playbackActive: true,
    });
  }, [
    usingHlsPlayback,
    hlsStartOffset,
    initialResumeSeconds,
  ]);

  const {
    subtitles,
    activeSubtitle,
    activeVtt,
    subtitleError,
    subtitleListError,
    clearSubtitleError,
    setActiveSubtitle: selectWebSubtitle,
    prefetchMenuTracks,
    refreshSubtitles,
    removeSubtitleTrack,
    opensubtitlesConfigured,
  } = useSubtitleTracks(
    fileId,
    type,
    videoRef,
    streamGeneration,
    usesNativePlayer && usingHlsPlayback ? hlsStartOffset : 0,
    {
      attachToVideo: !usesNativePlayer,
      displayMode: usesNativePlayer ? "native" : "dom-overlay",
    },
  );

  const selectSubtitle = useCallback(
    (subtitleId: number | null) => {
      activeSubtitleRef.current = subtitleId;
      selectWebSubtitle(subtitleId);
    },
    [selectWebSubtitle],
  );

  useEffect(() => {
    if (!subtitleMenuOpen) return;
    prefetchMenuTracks();
  }, [subtitleMenuOpen, prefetchMenuTracks]);

  const posterUrl = tvImageUrl(posterPath);
  const tvImageQuality = isTv4KClient() ? 90 : 80;

  const backHref =
    mediaId && !Number.isNaN(parseInt(mediaId, 10))
      ? routes.media(parseInt(mediaId, 10))
      : routes.home();

  const exitWatch = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    saveProgressRef.current();

    if (usesNativePlayer) {
      // Stop immediately; route-level cleanup remains a safety net. Bringing
      // the WebView forward prevents a native-surface/background flash.
      stopNativePlayback();
      setNativeWebOverlayAlpha(1);
    } else {
      videoRef.current?.pause();
      destroyHlsInstance(hlsRef.current);
      hlsRef.current = null;
    }

    if (usingHlsRef.current && !Number.isNaN(fileId)) {
      void api.stopStream(fileId, type).catch(() => {});
    }

    router.replace(backHref);
  }, [router, backHref, usesNativePlayer, fileId, type]);

  const handlePlaybackFinished = useCallback(() => {
    exitWatch();
  }, [exitWatch]);

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
  startNextEpisodeCountdownRef.current = startNextEpisodeCountdown;

  const isPreparing = initialResumeSeconds === null;
  useMarkTvBootReadyWhen(!isPreparing || Boolean(error));
  const showLoadingOverlay =
    !error &&
    !(!usingHlsPlayback && optimisticAbsoluteSeconds !== null) &&
    (isPreparing || (buffering && !playbackHasBegun));
  const centerMessageVisible = Boolean(error || countdown || showLoadingOverlay);

  const captureStreamRestartPosition = useCallback(() => {
    const absoluteTime = getPlaybackRestartSeconds({
      usingHls: usingHlsRef.current,
      hlsStartOffset: hlsStartOffsetRef.current,
      relativeSeconds: currentTimeRef.current,
      stableAbsoluteSeconds: lastStableAbsoluteSecondsRef.current,
    });
    pendingStreamStartRef.current = absoluteTime;
    lastStableAbsoluteSecondsRef.current = absoluteTime;
  }, []);

  /** HLS transcode/remux sessions expire server-side after idle — restart at current position. */
  const restartNativeHlsAtCurrentPosition = useCallback(() => {
    captureStreamRestartPosition();
    setStreamGeneration((g) => g + 1);
  }, [captureStreamRestartPosition]);

  const resumeNativeWithRecovery = useCallback(() => {
    const pausedMs = nativePausedAtRef.current
      ? Date.now() - nativePausedAtRef.current
      : 0;
    // Server drops idle transcode sessions after ~2 min — refresh HLS before resume when paused a while.
    if (usingHlsRef.current && pausedMs >= 45_000) {
      restartNativeHlsAtCurrentPosition();
      return;
    }
    resumeNativePlayback();
  }, [restartNativeHlsAtCurrentPosition]);

  useEffect(() => {
    cancelCountdown();
  }, [fileId, cancelCountdown]);

  useDocumentTitle(title || null);

  const rememberMenuFocus = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.hasAttribute("data-tv-item")) {
      menuReturnFocusRef.current = active;
    }
  }, []);

  const closeMenus = useCallback(() => {
    setSubtitleMenuOpen(false);
    setSubtitleAppearanceOpen(false);
    setQualityMenuOpen(false);
    setPanelOpen(false);

    requestAnimationFrame(() => {
      const target = menuReturnFocusRef.current;
      menuReturnFocusRef.current = null;
      if (!target?.isConnected) return;
      focusTvItem(target);
      if (target.hasAttribute("data-tv-watch-scrub")) {
        setScrubPreview(progressRef.current);
      }
    });
  }, []);

  const focusPlayControl = useCallback(() => {
    requestAnimationFrame(() => {
      const play = playButtonRef.current;
      if (play) focusTvItem(play);
    });
  }, []);

  const focusScrubControl = useCallback(() => {
    requestAnimationFrame(() => {
      const scrub = scrubButtonRef.current;
      if (!scrub) return;
      focusTvItem(scrub);
      setScrubPreview(progressRef.current);
    });
  }, []);

  const revealControls = useCallback(
    (autoHide = true, focusPlay = false) => {
      if (centerMessageVisible) return;
      controlsRevealedAtRef.current = Date.now();
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
        focusPlayControl();
      }
    },
    [
      centerMessageVisible,
      panelOpen,
      usesNativePlayer,
      isPlaying,
      scheduleControlsAutoHide,
      focusPlayControl,
    ],
  );

  const updateBufferedPosition = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const offset = usingHlsPlayback ? hlsStartOffsetRef.current : 0;
    const scrubberRanges = getScrubberBufferedRanges(
      getVideoBufferedRanges(video),
      video.currentTime,
    );
    setBufferedRanges(
      scrubberRanges.map((range) => ({
        start: offset + range.start,
        end: offset + range.end,
      })),
    );
  }, [usingHlsPlayback]);
  const updateBufferedPositionRef = useRef(updateBufferedPosition);
  updateBufferedPositionRef.current = updateBufferedPosition;

  const saveProgress = useCallback(() => {
    if (!fileId) return;

    const durationMs = Math.floor(
      sourceDurationMs || (duration ? duration * 1000 : 0),
    );
    if (!durationMs) return;

    const liveSeconds = usingHlsPlayback
      ? hlsStartOffsetRef.current + currentTime
      : currentTime;
    // Never persist a spot behind the last known-good position (guards
    // against a transient reset during restart/recovery).
    const positionSeconds = Math.max(liveSeconds, lastStableAbsoluteSecondsRef.current);
    if (positionSeconds <= 0) return;

    api
      .saveProgress({
        itemType: type === "movie" ? "movie" : "episode",
        itemId: fileId,
        positionMs: Math.floor(positionSeconds * 1000),
        durationMs,
      })
      .catch(() => {});
  }, [fileId, type, usingHlsPlayback, currentTime, sourceDurationMs, duration]);

  saveProgressRef.current = saveProgress;

  const changeQuality = useCallback(
    (nextQuality: StreamQuality) => {
      const relativeSeconds = usesNativePlayer
        ? currentTime
        : videoRef.current?.currentTime ?? currentTime;
      const absoluteTime = getPlaybackRestartSeconds({
        usingHls: usingHlsPlayback,
        hlsStartOffset: hlsStartOffsetRef.current,
        relativeSeconds,
        stableAbsoluteSeconds: lastStableAbsoluteSecondsRef.current,
      });
      pendingStreamStartRef.current = absoluteTime;
      lastStableAbsoluteSecondsRef.current = absoluteTime;
      setStreamGeneration((generation) => generation + 1);
      setQuality(nextQuality);
      nativeRemuxFallbackRef.current = false;
      nativeTranscodeFallbackRef.current = false;
      setForceRemux(false);
      closeMenus();
      setError(null);
      revealControls(true);
    },
    [closeMenus, revealControls, usingHlsPlayback, hlsStartOffset, usesNativePlayer, currentTime],
  );

  const tryFallbackQuality = useCallback(() => {
    const next = resolveFallbackQuality(
      quality,
      availableQualities,
      playbackStreamRef.current?.hlsQuality,
      sourceHeight,
      sourceWidth,
    );
    if (!next || next === quality) return false;
    changeQuality(next);
    return true;
  }, [quality, availableQualities, changeQuality, sourceHeight, sourceWidth]);

  tryFallbackQualityRef.current = tryFallbackQuality;

  const syncNativeSubtitles = useCallback(
    (options?: { restartOnFailure?: boolean }) => {
      if (!usesNativePlayer) return true;
      const info = streamInfoRef.current;
      if (!info || initialResumeSeconds === null || !fileId) return false;

      const subtitleId = activeSubtitleRef.current;
      const stream = resolvePlaybackStream(quality, info, { forceRemux });
      const usingHls = stream.usingHls;
      const subtitleOffset = usingHls ? hlsStartOffsetRef.current : 0;
      const subtitleUrl =
        subtitleId != null
          ? toAbsoluteMediaUrl(api.subtitleUrl(subtitleId, subtitleOffset))
          : undefined;

      if (subtitleId == null) {
        updateNativeSubtitles(undefined);
        nativeSubtitlesSyncedSessionRef.current = nativePlaySessionRef.current;
        return true;
      }

      if (updateNativeSubtitles(subtitleUrl)) {
        nativeSubtitlesSyncedSessionRef.current = nativePlaySessionRef.current;
        return true;
      }

      if (options?.restartOnFailure === false) return false;

      const relativeTime = currentTimeRef.current;
      const absoluteTime = getPlaybackRestartSeconds({
        usingHls,
        hlsStartOffset: hlsStartOffsetRef.current,
        relativeSeconds: relativeTime,
        stableAbsoluteSeconds: lastStableAbsoluteSecondsRef.current,
      });
      lastStableAbsoluteSecondsRef.current = absoluteTime;
      const relativeUrl = api.streamUrl(
        fileId,
        type === "movie" ? "movie" : "episode",
        quality,
        usingHls ? absoluteTime : undefined,
        streamGeneration,
        stream.hlsQuality,
      );

      nativePlaySessionRef.current += 1;
      nativeErrorHandledSessionRef.current = nativePlaySessionRef.current - 1;
      nativeSubtitlesSyncedSessionRef.current = -1;

      startNativePlayback({
        url: toAbsoluteMediaUrl(relativeUrl),
        title: titleRef.current || "MEDIA!",
        posterUrl: posterUrl ? toAbsoluteMediaUrl(posterUrl) : undefined,
        fileId,
        itemType: type === "movie" ? "movie" : "episode",
        startSeconds: usingHls ? 0 : absoluteTime,
        durationMs: sourceDurationMs || info.durationMs || 0,
        isHls: usingHls,
        isHdr: needsHdrToneMap(info.dynamicRange),
        dolbyVision: info.dynamicRange?.dolbyVision ?? false,
        subtitleUrl,
      });

      if (usingHls && relativeTime > 0) {
        seekNativePlayback(relativeTime * 1000);
      }

      return true;
    },
    [
      usesNativePlayer,
      fileId,
      type,
      quality,
      forceRemux,
      streamGeneration,
      sourceDurationMs,
      initialResumeSeconds,
    ],
  );

  const selectSubtitleOnNative = useCallback(
    (subtitleId: number | null) => {
      selectSubtitle(subtitleId);
      if (!usesNativePlayer) return;
      nativeSubtitlesSyncedSessionRef.current = -1;
      void syncNativeSubtitles({ restartOnFailure: subtitleId != null });
    },
    [selectSubtitle, syncNativeSubtitles, usesNativePlayer],
  );

  useEffect(() => {
    if (!usesNativePlayer) return;

    document.documentElement.setAttribute("data-native-video", "true");
    prepareNativeVideoOverlay();
    applySubtitleStyles(readSubtitleStyles());
    return registerNativePlayerHandlers({
      onState: (state) => {
        setCurrentTime(state.currentTime);
        if (state.duration > 0) setDuration(state.duration);
        if (!state.isBuffering) {
          const absoluteTime = usingHlsRef.current
            ? hlsStartOffsetRef.current + state.currentTime
            : state.currentTime;
          lastStableAbsoluteSecondsRef.current = nextStableAbsoluteSeconds(
            lastStableAbsoluteSecondsRef.current,
            absoluteTime,
          );
        }
        if (nativeWasPlayingRef.current && !state.isPlaying) {
          saveProgressRef.current();
        }
        nativeWasPlayingRef.current = state.isPlaying;
        nativeIsPlayingRef.current = state.isPlaying;
        if (state.isPlaying) {
          nativePausedAtRef.current = null;
        } else if (nativePausedAtRef.current === null) {
          nativePausedAtRef.current = Date.now();
        }
        setIsPlaying(state.isPlaying);
        setBuffering(state.isBuffering && !state.ready);
        setBufferingMidPlayback(state.isBuffering && state.ready);
        if (state.ready || state.isPlaying || state.buffered > 0.5) {
          setPlaybackHasBegun(true);
        }
        if (
          state.ready &&
          activeSubtitleRef.current != null &&
          nativeSubtitlesSyncedSessionRef.current !== nativePlaySessionRef.current
        ) {
          void syncNativeSubtitles({ restartOnFailure: false });
        }
        const offset = hlsStartOffsetRef.current;
        const relativeRanges =
          state.bufferedRanges && state.bufferedRanges.length > 0
            ? state.bufferedRanges
            : usingHlsRef.current
              ? [{ start: 0, end: state.buffered }]
              : [{ start: 0, end: state.buffered }];
        const scrubberRanges = getScrubberBufferedRanges(
          relativeRanges,
          state.currentTime,
        );
        setBufferedRanges(
          scrubberRanges.map((range) => ({
            start: range.start + offset,
            end: range.end + offset,
          })),
        );
      },
      onError: () => {
        const session = nativePlaySessionRef.current;
        if (nativeErrorHandledSessionRef.current >= session) return;
        nativeErrorHandledSessionRef.current = session;

        setBuffering(false);
        captureStreamRestartPosition();
        const info = streamInfoRef.current;
        if (
          !nativeRemuxFallbackRef.current &&
          !usingHlsRef.current &&
          info?.transcodingEnabled &&
          isHlsVideoCopySupported(info.videoCodec)
        ) {
          nativeRemuxFallbackRef.current = true;
          setForceRemux(true);
          setStreamGeneration((g) => g + 1);
          return;
        }
        if (
          nativeRemuxFallbackRef.current &&
          usingHlsRef.current &&
          !nativeTranscodeFallbackRef.current &&
          info &&
          is4KSource(info.height, info.width) &&
          info.availableQualities.includes("1080p")
        ) {
          nativeTranscodeFallbackRef.current = true;
          setForceRemux(false);
          setQuality("1080p");
          setStreamGeneration((g) => g + 1);
          return;
        }
        if (
          usingHlsRef.current &&
          info?.transcodingEnabled &&
          nativeHlsRecoveryAttemptsRef.current < 3
        ) {
          nativeHlsRecoveryAttemptsRef.current += 1;
          restartNativeHlsAtCurrentPosition();
          return;
        }
        // Keep the user's quality choice on TV — don't silently downgrade further.
        setError("Playback failed. Try Original again or pick a lower quality from the settings menu.");
      },
      onEnded: () => {
        const sourceSeconds = (streamInfoRef.current?.durationMs || 0) / 1000;
        if (
          usingHlsRef.current &&
          isSpuriousHlsEnded({
            usingHls: true,
            relativeSeconds: currentTimeRef.current,
            hlsStartOffset: hlsStartOffsetRef.current,
            sourceDurationSeconds: sourceSeconds,
          })
        ) {
          setBuffering(true);
          restartNativeHlsAtCurrentPosition();
          return;
        }
        setIsPlaying(false);
        saveProgressRef.current();
        startNextEpisodeCountdownRef.current();
      },
    });
  }, [usesNativePlayer, captureStreamRestartPosition, restartNativeHlsAtCurrentPosition, syncNativeSubtitles]);

  useEffect(() => {
    if (!usesNativePlayer) return;
    return () => {
      document.documentElement.removeAttribute("data-native-video");
      setNativeWebOverlayAlpha(1);
      stopNativePlayback();
    };
  }, [usesNativePlayer]);

  useEffect(() => {
    setStreamGeneration(0);
    pendingStreamStartRef.current = null;
    setForceRemux(false);
    nativeRemuxFallbackRef.current = false;
    nativeTranscodeFallbackRef.current = false;
    nativeHlsRecoveryAttemptsRef.current = 0;
    nativePausedAtRef.current = null;
    nativeIsPlayingRef.current = false;
    nativePlaySessionRef.current = 0;
    nativeErrorHandledSessionRef.current = 0;
    nativeSubtitlesSyncedSessionRef.current = -1;
    activeSubtitleRef.current = null;
    menuReturnFocusRef.current = null;
    setShowControls(true);
    setPlaybackHasBegun(false);
    lastStableAbsoluteSecondsRef.current = 0;
    hlsStartOffsetRef.current = 0;
    setHlsStartOffset(0);
  }, [fileId, type]);

  useEffect(() => {
    const isPreparingPlayback = initialResumeSeconds === null || !streamInfo;
    if (!isPreparingPlayback && isPlaying && !buffering) {
      setPlaybackHasBegun(true);
    }
  }, [initialResumeSeconds, streamInfo, isPlaying, buffering]);

  useEffect(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (centerMessageVisible) {
      setShowControls(false);
      return;
    }
    if (!isPlaying && !bufferingMidPlayback) {
      setShowControls(true);
      return;
    }
    if (!panelOpen) {
      scheduleControlsAutoHide();
    }
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [centerMessageVisible, isPlaying, bufferingMidPlayback, panelOpen, scheduleControlsAutoHide]);

  useEffect(() => {
    if (!bufferingMidPlayback || !panelOpen) return;
    closeMenus();
  }, [bufferingMidPlayback, panelOpen, closeMenus]);

  useEffect(() => {
    setPosterPath(null);
  }, [fileId, type]);

  useEffect(() => {
    if (!fileId || Number.isNaN(fileId)) return;

    setInitialResumeSeconds(null);
    setError(null);

    api
      .getStreamInfo(fileId, type === "movie" ? "movie" : "episode")
      .then((info: StreamInfo) => {
        setStreamInfo(info);
        if (info.posterPath) {
          setPosterPath(info.posterPath);
        }
        setAvailableQualities(info.availableQualities);
        setSourceHeight(info.height ?? null);
        setSourceWidth(info.width ?? null);
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
            const resumeSeconds = positionMs / 1000;
            setInitialResumeSeconds(resumeSeconds);
            return;
          }
        }
        setInitialResumeSeconds(0);
      })
      .catch((err) => {
        console.error(err);
        setError("Could not load this video. Check your connection and try again.");
        setInitialResumeSeconds(0);
      });
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

    const playback = resolvePlaybackStream(quality, streamInfo, { forceRemux });
    if (!playback.usingHls && playback.audioCompatNotice) {
      return;
    }

    const explicitStreamStart = pendingStreamStartRef.current;
    if (explicitStreamStart !== null) {
      pendingStreamStartRef.current = null;
    }

    const startAt = resolvePlaybackStartSeconds({
      streamStartSeconds: explicitStreamStart,
      initialResumeSeconds,
      streamGeneration,
      usingHls: usingHlsRef.current,
      hlsStartOffset: hlsStartOffsetRef.current,
      relativeSeconds: currentTimeRef.current,
      stableAbsoluteSeconds: lastStableAbsoluteSecondsRef.current,
    });
    const stream = resolvePlaybackStream(quality, streamInfo, { forceRemux });
    const usingHls = stream.usingHls;

    if (wasUsingHlsRef.current && !usingHls) {
      void api.stopStream(fileId, type).catch(() => {});
    }
    wasUsingHlsRef.current = usingHls;

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
      lastStableAbsoluteSecondsRef.current = startAt;
      setCurrentTime(usingHls || startAt <= 0 ? 0 : startAt);

      const relativeUrl = api.streamUrl(
        fileId,
        type === "movie" ? "movie" : "episode",
        quality,
        usingHls ? startAt : undefined,
        streamGeneration,
        stream.hlsQuality,
      );

      nativePlaySessionRef.current += 1;
      nativeErrorHandledSessionRef.current = nativePlaySessionRef.current - 1;
      nativeSubtitlesSyncedSessionRef.current = -1;

      setNativeWebOverlayAlpha(0);
      applySubtitleStyles(readSubtitleStyles());
      startNativePlayback({
        url: toAbsoluteMediaUrl(relativeUrl),
        title: titleRef.current || "MEDIA!",
        posterUrl: posterUrl ? toAbsoluteMediaUrl(posterUrl) : undefined,
        fileId,
        itemType: type === "movie" ? "movie" : "episode",
        startSeconds: usingHls ? 0 : startAt,
        durationMs: sourceDurationMs || streamInfo.durationMs || 0,
        isHls: usingHls,
        isHdr: needsHdrToneMap(streamInfo.dynamicRange),
        dolbyVision: streamInfo.dynamicRange?.dolbyVision ?? false,
        subtitleUrl:
          activeSubtitle != null
            ? toAbsoluteMediaUrl(api.subtitleUrl(activeSubtitle, usingHls ? startAt : 0))
            : undefined,
      });

      progressInterval.current = setInterval(
        () => saveProgressRef.current(),
        PROGRESS_SAVE_MS,
      );

      return () => {
        stopNativePlayback();
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
    spuriousRecoveryStateRef.current = {
      attempts: 0,
      lastEndedAtMs: 0,
      anchorSeconds: 0,
    };

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
    lastStableAbsoluteSecondsRef.current = startAt;

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

    const sessionGen = streamGeneration;
    const onFatalError = () => {
      if (playbackFatalHandledRef.current === sessionGen) return;
      playbackFatalHandledRef.current = sessionGen;
      setOptimisticAbsoluteSeconds(null);
      setBuffering(false);
      if (tryFallbackQualityRef.current()) return;
      setError("Playback failed. Try a lower quality from the settings menu.");
    };

    let cancelled = false;
    let webPlayback: ReturnType<typeof startWebPlayback> | null = null;

    void (async () => {
      try {
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
          onBufferUpdate: () => updateBufferedPositionRef.current(),
          onSeekComplete: (seconds) => setCurrentTime(seconds),
          onSourceReady: notifyWebPlaybackSourceReady,
        });

        if (cancelled) {
          webPlayback.cleanup();
          return;
        }

        hlsRef.current = webPlayback.hls;
      } catch (err) {
        console.error(err);
        if (!cancelled) onFatalError();
      }
    })();

    progressInterval.current = setInterval(() => saveProgressRef.current(), PROGRESS_SAVE_MS);

    return () => {
      cancelled = true;
      video.pause();
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
    initialResumeSeconds,
    streamInfo,
    usesNativePlayer,
    forceRemux,
  ]);

  useEffect(() => {
    return () => {
      void api.stopStream(fileId, type).catch(() => {});
    };
  }, [fileId, type]);

  // Steady-cadence buffer status refresh — buffer events are sparse and stop
  // while paused, so poll video.buffered directly to keep the bar consistent.
  useEffect(() => {
    if (!fileId || Number.isNaN(fileId)) return;
    const interval = setInterval(() => {
      updateBufferedPositionRef.current();
    }, 500);
    return () => clearInterval(interval);
  }, [fileId]);

  useEffect(() => {
    activeSubtitleRef.current = activeSubtitle;
  }, [activeSubtitle]);

  useEffect(() => {
    if (!usesNativePlayer || !streamInfo || initialResumeSeconds === null || !fileId) {
      return;
    }

    void syncNativeSubtitles({ restartOnFailure: false });
  }, [
    activeSubtitle,
    usesNativePlayer,
    streamInfo,
    initialResumeSeconds,
    fileId,
    hlsStartOffset,
    streamGeneration,
    syncNativeSubtitles,
  ]);

  useEffect(() => {
    const onPageHide = () => {
      if (!fileId) return;

      const durationMs = Math.floor(
        sourceDurationMs || (duration ? duration * 1000 : 0),
      );
      if (!durationMs) return;

      const positionSeconds = usingHlsPlayback
        ? hlsStartOffsetRef.current + currentTimeRef.current
        : currentTimeRef.current;

      void api
        .saveProgress(
          {
            itemType: type === "movie" ? "movie" : "episode",
            itemId: fileId,
            positionMs: Math.floor(positionSeconds * 1000),
            durationMs,
          },
          { keepalive: true },
        )
        .catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [fileId, type, usingHlsPlayback, sourceDurationMs, duration]);

  const resumeAnchorSeconds =
    hlsStartOffset > 0 ? hlsStartOffset : (initialResumeSeconds ?? 0);
  const playbackAbsoluteTime =
    usingHlsPlayback ? hlsStartOffsetRef.current + currentTime : currentTime;
  const absoluteCurrentTime =
    !playbackHasBegun &&
    scrubPreview === null &&
    optimisticAbsoluteSeconds === null &&
    resumeAnchorSeconds > 0 &&
    playbackAbsoluteTime < resumeAnchorSeconds - 1.5
      ? resumeAnchorSeconds
      : playbackAbsoluteTime;
  const absoluteDurationMs = sourceDurationMs || duration * 1000;
  const totalDurationSeconds =
    absoluteDurationMs > 0 ? absoluteDurationMs / 1000 : 0;
  const progress =
    absoluteDurationMs > 0 ? (absoluteCurrentTime * 1000) / absoluteDurationMs * 100 : 0;
  const displayedAbsoluteTime =
    scrubPreview !== null && absoluteDurationMs > 0
      ? (scrubPreview / 100) * totalDurationSeconds
      : optimisticAbsoluteSeconds !== null
        ? optimisticAbsoluteSeconds
        : absoluteCurrentTime;
  const optimisticProgressPercent =
    optimisticAbsoluteSeconds !== null && absoluteDurationMs > 0
      ? ((optimisticAbsoluteSeconds * 1000) / absoluteDurationMs) * 100
      : null;
  const displayedProgress = scrubPreview ?? optimisticProgressPercent ?? progress;
  progressRef.current = displayedProgress;
  currentTimeRef.current = currentTime;
  const toTimelinePercent = (seconds: number) =>
    absoluteDurationMs > 0
      ? Math.min(100, Math.max(0, ((seconds * 1000) / absoluteDurationMs) * 100))
      : 0;

  const seekToAbsolute = useCallback(
    (seconds: number) => {
      if (!totalDurationSeconds) return;

      const clamped = Math.max(0, Math.min(seconds, totalDurationSeconds));
      setOptimisticAbsoluteSeconds(clamped);
      lastStableAbsoluteSecondsRef.current = clamped;

      if (usesNativePlayer) {
        if (usingHlsPlayback && clamped < hlsStartOffset) {
          pendingStreamStartRef.current = clamped;
          setStreamGeneration((g) => g + 1);
          setBuffering(true);
          revealControls(true);
          return;
        }

        const relativeTarget = usingHlsPlayback ? clamped - hlsStartOffset : clamped;
        const inBufferedRange =
          !usingHlsPlayback ||
          bufferedRanges.some(
            (range) => clamped >= range.start - 0.5 && clamped <= range.end + 0.5,
          );

        if (usingHlsPlayback && !inBufferedRange) {
          pendingStreamStartRef.current = clamped;
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
        pendingStreamStartRef.current = clamped;
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

      pendingStreamStartRef.current = clamped;
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

  const handleScrubCommit = useCallback(
    (value: number) => {
      setScrubPreview(null);
      if (totalDurationSeconds > 0) {
        seekToAbsolute((value / 100) * totalDurationSeconds);
      }
    },
    [seekToAbsolute, totalDurationSeconds],
  );

  const playPlayback = useCallback(() => {
    if (usesNativePlayer) {
      resumeNativeWithRecovery();
      revealControls(true);
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    }
    revealControls(true);
  }, [revealControls, usesNativePlayer, resumeNativeWithRecovery]);

  const pausePlayback = useCallback(() => {
    if (usesNativePlayer) {
      pauseNativePlayback();
      revealControls(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
    }
    revealControls(false);
  }, [revealControls, usesNativePlayer]);

  const togglePlay = useCallback(() => {
    const playing = usesNativePlayer
      ? nativeIsPlayingRef.current
      : Boolean(videoRef.current && !videoRef.current.paused);

    if (playing) {
      pausePlayback();
      return;
    }

    playPlayback();
  }, [pausePlayback, playPlayback, usesNativePlayer]);

  useEffect(() => {
    setPanelOpen(subtitleMenuOpen || subtitleAppearanceOpen || qualityMenuOpen);
  }, [subtitleMenuOpen, subtitleAppearanceOpen, qualityMenuOpen]);

  useEffect(() => {
    if (!error) return;
    setOptimisticAbsoluteSeconds(null);
  }, [error]);

  useEffect(() => {
    if (optimisticAbsoluteSeconds === null) return;
    if (Math.abs(absoluteCurrentTime - optimisticAbsoluteSeconds) < 1.5) {
      setOptimisticAbsoluteSeconds(null);
    }
  }, [absoluteCurrentTime, optimisticAbsoluteSeconds]);

  usePlaybackVisibility({
    enabled: Boolean(fileId && !Number.isNaN(fileId)),
    onSaveProgress: saveProgress,
    onVisible: () => {
      if (!usingHlsPlayback || usesNativePlayer) return;
      const video = videoRef.current;
      if (!video) return;
      catchUpHlsPlayback(video, hlsRef.current);
    },
  });

  const playbackBufferingRef = useRef(false);

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
        if (videoRef.current?.getAttribute("data-buffer-gate") === "1") {
          return;
        }
        setIsPlaying(false);
        revealControls(false);
      },
      onSaveProgress: () => {
        if (videoRef.current?.getAttribute("data-buffer-gate") === "1") {
          return;
        }
        saveProgress();
      },
      onBufferUpdate: updateBufferedPosition,
      onEnded: () => {
        const video = videoRef.current;
        const sourceSeconds = (sourceDurationMs || 0) / 1000;
        if (
          video &&
          isSpuriousHlsEnded({
            usingHls: usingHlsPlayback,
            relativeSeconds: video.currentTime,
            hlsStartOffset: hlsStartOffsetRef.current,
            sourceDurationSeconds: sourceSeconds,
            playlistRelativeSeconds: video.duration,
          })
        ) {
          const absoluteResume = Math.max(
            hlsStartOffsetRef.current + video.currentTime,
            lastStableAbsoluteSecondsRef.current,
          );
          lastStableAbsoluteSecondsRef.current = absoluteResume;
          setBuffering(true);

          const decision = resolveSpuriousRecovery({
            state: spuriousRecoveryStateRef.current,
            nowMs: Date.now(),
            relativeSeconds: video.currentTime,
          });
          spuriousRecoveryStateRef.current = decision.next;

          if (hlsRef.current) {
            recoverHlsPlaybackAtPlaylistEnd(video, hlsRef.current);
          } else {
            pendingStreamStartRef.current = absoluteResume;
            setStreamGeneration((generation) => generation + 1);
          }
          return;
        }
        spuriousRecoveryStateRef.current = {
          attempts: 0,
          lastEndedAtMs: 0,
          anchorSeconds: 0,
        };
        setIsPlaying(false);
        startNextEpisodeCountdown();
      },
      onCurrentTime: (seconds) => {
        setCurrentTime(seconds);
        if (!playbackBufferingRef.current) {
          const absoluteTime = usingHlsPlayback
            ? hlsStartOffsetRef.current + seconds
            : seconds;
          lastStableAbsoluteSecondsRef.current = nextStableAbsoluteSeconds(
            lastStableAbsoluteSecondsRef.current,
            absoluteTime,
          );
          const recovery = spuriousRecoveryStateRef.current;
          if (
            recovery.attempts > 0 &&
            seconds - recovery.anchorSeconds >= SPURIOUS_RECOVERY_PROGRESS_SECONDS
          ) {
            spuriousRecoveryStateRef.current = {
              attempts: 0,
              lastEndedAtMs: 0,
              anchorSeconds: 0,
            };
          }
        }
      },
      onDuration: setDuration,
      onBuffering: (nextBuffering, midPlayback) => {
        playbackBufferingRef.current = nextBuffering || midPlayback;
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
    if (!subtitleMenuOpen && !subtitleAppearanceOpen && !qualityMenuOpen) return;
    requestAnimationFrame(() => {
      focusFirstWatchMenuItem();
    });
  }, [subtitleMenuOpen, subtitleAppearanceOpen, qualityMenuOpen]);

  useEffect(() => {
    if (!subtitleSearchOpen) return;
    requestAnimationFrame(() => {
      focusFirstWatchMenuItem();
    });
  }, [subtitleSearchOpen]);

  useEffect(() => {
    if (!error) return;
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>("[data-tv-watch-error] [data-tv-item]");
      if (first) focusTvItem(first);
    });
  }, [error]);

  const showPosterBackdrop =
    Boolean(posterUrl) && !playbackHasBegun && !error && !usesNativePlayer;
  const showMidPlaybackBuffering =
    bufferingMidPlayback && playbackHasBegun && !error && !countdown;
  const showBufferingBar = showMidPlaybackBuffering;
  const loadingMessage = isPreparing
    ? "Preparing playback..."
    : bufferingMidPlayback
      ? "Buffering..."
      : usingHlsPlayback && quality === "original"
        ? "Preparing original stream..."
        : usingHlsPlayback
          ? `Starting ${(playbackStream.hlsQuality ?? quality).toUpperCase()} stream...`
          : "Loading video...";
  const controlsVisible = (showControls || panelOpen) && !centerMessageVisible;
  const hidePlaybackSubtitles =
    (subtitleMenuOpen && !subtitleAppearanceOpen) ||
    qualityMenuOpen ||
    subtitleSearchOpen;
  const showTransportControls = Boolean(
    streamInfo && initialResumeSeconds !== null && !error && !countdown,
  );

  useEffect(() => {
    if (!centerMessageVisible) return;
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setShowControls(false);
    releaseWatchFocus();
  }, [centerMessageVisible, releaseWatchFocus]);

  const nativeWebOverlayRaised =
    controlsVisible ||
    Boolean(error || countdown) ||
    (usesNativePlayer && showMidPlaybackBuffering);

  useEffect(() => {
    if (!usesNativePlayer) return;
    // Only raise the WebView layer for controls and blocking dialogs — never for
    // the loading spinner, which was covering ExoPlayer and causing black screens.
    setNativeWebOverlayAlpha(nativeWebOverlayRaised ? 1 : 0);
  }, [usesNativePlayer, nativeWebOverlayRaised]);

  const timelinePreviewPercent = scrubPreview ?? optimisticProgressPercent ?? progress;
  const timelinePreviewMs =
    totalDurationSeconds > 0
      ? (timelinePreviewPercent / 100) * totalDurationSeconds * 1000
      : 0;
  const showScrubPreview =
    showTransportControls &&
    scrubPreview !== null &&
    totalDurationSeconds > 0;

  const seekPreviewMaxWidth = isTv4KClient() ? 224 : 200;

  const controlIconButtonClassName = "watch-control-btn shrink-0";
  const controlLabelButtonClassName = "watch-control-btn watch-control-btn--label shrink-0";

  const handleWatchBack = useCallback((): boolean => {
    if (countdown) {
      cancelCountdown();
      exitWatch();
      return true;
    }
    if (subtitleSearchOpen) {
      setSubtitleSearchOpen(false);
      revealControls(false);
      return true;
    }
    if (subtitleAppearanceOpen) {
      setSubtitleAppearanceOpen(false);
      setSubtitleMenuOpen(true);
      return true;
    }
    if (panelOpen) {
      closeMenus();
      revealControls(false);
      return true;
    }
    if (controlsVisible) {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      setShowControls(false);
      controlsRevealedAtRef.current = null;
      releaseWatchFocus();
      return true;
    }
    exitWatch();
    return true;
  }, [
    countdown,
    cancelCountdown,
    exitWatch,
    subtitleSearchOpen,
    subtitleAppearanceOpen,
    panelOpen,
    closeMenus,
    revealControls,
    controlsVisible,
    releaseWatchFocus,
  ]);

  useEffect(() => registerWatchBackHandler(handleWatchBack), [handleWatchBack]);

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
        e.preventDefault();
        handleWatchBack();
        return;
      }

      if (subtitleSearchOpen) return;

      if (!centerMessageVisible) {
        if (e.key === "MediaPlay") {
          e.preventDefault();
          playPlayback();
          return;
        }

        if (e.key === "MediaPause") {
          e.preventDefault();
          pausePlayback();
          return;
        }

        if (e.key === "MediaPlayPause") {
          e.preventDefault();
          togglePlay();
          return;
        }
      }

      if (panelOpen) return;

      if (centerMessageVisible) return;

      if (active?.hasAttribute("data-tv-watch-scrub")) {
        if (
          e.key === "Enter" ||
          e.key === "NumpadEnter" ||
          e.key === "Select"
        ) {
          if (scrubPreview !== null) {
            e.preventDefault();
            handleScrubCommit(scrubPreview);
          }
          return;
        }
        if (e.key === "ArrowLeft" || e.key === "MediaRewind") {
          e.preventDefault();
          if (totalDurationSeconds > 0) {
            const stepPercent =
              totalDurationSeconds > 0 ? (10 / totalDurationSeconds) * 100 : 2;
            setScrubPreview((current) =>
              Math.max(0, (current ?? displayedProgress) - stepPercent),
            );
          }
          return;
        }
        if (e.key === "ArrowRight" || e.key === "MediaFastForward") {
          e.preventDefault();
          if (totalDurationSeconds > 0) {
            const stepPercent =
              totalDurationSeconds > 0 ? (10 / totalDurationSeconds) * 100 : 2;
            setScrubPreview((current) =>
              Math.min(100, (current ?? displayedProgress) + stepPercent),
            );
          }
          return;
        }
      }

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

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }

      const isNavigationKey =
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "MediaRewind" ||
        e.key === "MediaFastForward";

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (controlsVisible && active?.hasAttribute("data-tv-watch-scrub")) {
          const play = playButtonRef.current;
          if (play) {
            focusTvItem(play);
            return;
          }
        }
        revealControls(false, true);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (
          controlsVisible &&
          active?.closest("[data-tv-watch-transport-row]") &&
          !active?.hasAttribute("data-tv-watch-scrub")
        ) {
          const scrub = document.querySelector<HTMLElement>("[data-tv-watch-scrub]");
          if (scrub) {
            focusTvItem(scrub);
            return;
          }
        }
        if (!controlsVisible && showTransportControls) {
          revealControls(false, true);
          return;
        }
      }

      if (
        controlsVisible &&
        !panelOpen &&
        !subtitleSearchOpen &&
        !active?.closest("[data-tv-watch-controls]") &&
        !active?.hasAttribute("data-tv-watch-scrub")
      ) {
        if (isNavigationKey) {
          e.preventDefault();
          revealControls(false, true);
          return;
        }
      }

      if (active?.closest("[data-tv-watch-controls]")) return;

      if (
        !controlsVisible &&
        showTransportControls &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "MediaRewind" ||
          e.key === "MediaFastForward")
      ) {
        e.preventDefault();
        revealControls(false);
        focusScrubControl();
        if (e.key === "MediaRewind") {
          setScrubPreview((current) => {
            const stepPercent =
              totalDurationSeconds > 0 ? (10 / totalDurationSeconds) * 100 : 2;
            return Math.max(0, (current ?? displayedProgress) - stepPercent);
          });
        } else if (e.key === "MediaFastForward") {
          setScrubPreview((current) => {
            const stepPercent =
              totalDurationSeconds > 0 ? (10 / totalDurationSeconds) * 100 : 2;
            return Math.min(100, (current ?? displayedProgress) + stepPercent);
          });
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    togglePlay,
    playPlayback,
    pausePlayback,
    skipRelative,
    handleScrubCommit,
    handleWatchBack,
    panelOpen,
    subtitleSearchOpen,
    closeMenus,
    revealControls,
    centerMessageVisible,
    controlsVisible,
    showTransportControls,
    totalDurationSeconds,
    displayedProgress,
    scrubPreview,
    focusScrubControl,
  ]);

  useEffect(() => {
    if (!controlsVisible && !panelOpen) {
      releaseWatchFocus();
    }
  }, [controlsVisible, panelOpen, releaseWatchFocus]);

  if (!fileId || Number.isNaN(fileId)) {
    if (!isClient) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-black">
          <Loader2 className="h-9 w-9 animate-spin text-primary" />
        </div>
      );
    }

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
      className={cn(
        "fixed inset-0 z-40",
        usesNativePlayer ? "bg-transparent" : "bg-black",
      )}
      onMouseMove={() => {
        if (!centerMessageVisible) revealControls(true, true);
      }}
      onClick={() => {
        if (!centerMessageVisible) revealControls(true, true);
      }}
    >
      {/* Video stage — full-screen picture; controls overlay top/bottom */}
      <div
        data-tv-watch-video-stage=""
        className="relative h-full w-full bg-transparent"
      >
        <PlaybackPosterBackdrop
          posterUrl={posterUrl}
          visible={showPosterBackdrop}
          transparentBackground={usesNativePlayer}
        />
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
            className={cn(
              "media-subtitles absolute inset-0 z-[2] h-full w-full outline-none focus:outline-none",
              videoDisplayModeClass(videoDisplayMode),
              !usesNativePlayer &&
                needsTvSdUpscaleSoftening(sourceHeight, sourceWidth) &&
                "tv-sd-upscale-soften",
            )}
            controls={false}
            playsInline
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
        {!usesNativePlayer && activeSubtitle !== null && activeVtt && (
          <WebSubtitleCueOverlay
            videoRef={videoRef}
            vtt={activeVtt}
            getPlaybackSeconds={getSubtitlePlaybackSeconds}
            streamEpoch={streamGeneration}
            hidden={hidePlaybackSubtitles}
          />
        )}
        {!usesNativePlayer && subtitleError && (
          <SubtitleLoadNotice
            message={subtitleError}
            onDismiss={clearSubtitleError}
            className="absolute bottom-28 left-1/2 z-30 w-[min(28rem,calc(100%-3rem))] -translate-x-1/2"
          />
        )}

        {showLoadingOverlay && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "absolute inset-0 z-10 flex items-center justify-center",
              usesNativePlayer ? "bg-transparent" : "bg-black/40",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-xl border border-white/10 px-4 py-3 text-base text-white",
                usesNativePlayer ? "bg-black/75" : "bg-background/80",
              )}
            >
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {loadingMessage}
            </div>
          </div>
        )}

        {showBufferingBar && <div className="watch-buffering-bar" aria-hidden="true" />}

        {showMidPlaybackBuffering && !controlsVisible && !panelOpen && (
          <div
            className="pointer-events-none absolute inset-0 z-[15] flex flex-col justify-end"
            aria-live="polite"
            aria-label="Buffering"
          >
            <div className="flex flex-col items-center gap-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-8">
              <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/75 px-4 py-2.5 text-sm text-white">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Buffering...
              </div>
              {showTransportControls && totalDurationSeconds > 0 && (
                <div className="w-full max-w-3xl">
                  <TvWatchScrubTrack
                    bufferedRanges={bufferedRanges}
                    progress={displayedProgress}
                    bufferingMidPlayback={bufferingMidPlayback}
                    toTimelinePercent={toTimelinePercent}
                    optimisticSeek={optimisticAbsoluteSeconds !== null}
                  />
                </div>
              )}
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
              exitWatch();
            }}
            onPlayNow={playNextEpisodeNow}
          />
        )}

        {error && (
          <div
            data-tv-watch-error=""
            role="alertdialog"
            aria-label="Playback error"
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 px-8"
          >
            <div className="max-w-lg text-center">
              <p className="mb-6 text-lg text-red-400">{error}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {transcodingEnabled &&
                  resolveFallbackQuality(
                    quality,
                    availableQualities,
                    playbackStream.hlsQuality,
                    sourceHeight,
                    sourceWidth,
                  ) && (
                    <TvFocusButton
                      onClick={() => {
                        const next = resolveFallbackQuality(
                          quality,
                          availableQualities,
                          playbackStream.hlsQuality,
                          sourceHeight,
                          sourceWidth,
                        );
                        if (next) changeQuality(next);
                      }}
                      className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
                    >
                      Try{" "}
                      {qualityLabel(
                        resolveFallbackQuality(
                          quality,
                          availableQualities,
                          playbackStream.hlsQuality,
                          sourceHeight,
                          sourceWidth,
                        )!,
                        sourceHeight,
                        sourceWidth,
                      )}
                    </TvFocusButton>
                  )}
                <TvFocusLink
                  href={backHref}
                  onClick={(e) => {
                    e.preventDefault();
                    exitWatch();
                  }}
                  className="inline-flex rounded-xl border border-white/20 px-6 py-3 font-semibold text-white"
                >
                  Go back
                </TvFocusLink>
              </div>
            </div>
          </div>
        )}

        {/* Top chrome overlays the video while controls are visible */}
        {controlsVisible && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
            <div
              className={cn(
                "pointer-events-auto px-5 pb-4 pt-5",
                usesNativePlayer
                  ? "bg-transparent"
                  : "watch-chrome-top",
              )}
            >
              <div
                data-tv-row=""
                data-tv-content-row=""
                data-tv-watch-controls=""
                className="flex items-center gap-2 py-0.5"
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-base font-semibold text-white",
                      usesNativePlayer && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]",
                    )}
                  >
                    {title || "Playing"}
                  </p>
                  <p
                    className={cn(
                      "text-xs text-white/70",
                      usesNativePlayer && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]",
                    )}
                  >
                    {qualityLabel(quality, sourceHeight, sourceWidth)}
                    {formatDynamicRangeChromeSuffix(streamInfo?.dynamicRange)}
                    {activeSubtitle !== null && " · Subtitles on"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bottom chrome overlays the video — keeps the picture full-screen */}
        {showTransportControls && controlsVisible && (
          <div
            data-tv-watch-bottom-chrome=""
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
          >
            <div className="watch-chrome-bottom pointer-events-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-8">
              <div className="group/watch-scrub relative mb-3 flex items-center gap-3 overflow-visible">
                <div
                  data-tv-row=""
                  data-tv-content-row=""
                  data-tv-watch-controls=""
                  data-tv-watch-scrub-row=""
                  className="relative min-w-0 flex-1 overflow-visible"
                >
                  {showScrubPreview && (
                    <SeekPreviewTooltip
                      variant="floating"
                      maxThumbWidth={seekPreviewMaxWidth}
                      percent={timelinePreviewPercent}
                      timeMs={timelinePreviewMs}
                      cue={lookupCue(timelinePreviewMs)}
                      spriteUrl={thumbnails?.spriteUrl ?? null}
                    />
                  )}
                  <div className="relative h-5">
                    <TvWatchScrubTrack
                      bufferedRanges={bufferedRanges}
                      progress={displayedProgress}
                      previewPercent={scrubPreview}
                      bufferingMidPlayback={bufferingMidPlayback}
                      toTimelinePercent={toTimelinePercent}
                      optimisticSeek={
                        scrubPreview !== null || optimisticAbsoluteSeconds !== null
                      }
                    />
                    <TvFocusButton
                      ref={scrubButtonRef}
                      data-tv-watch-scrub=""
                      aria-label="Progress"
                      onClick={() => revealControls(false)}
                      onFocus={() => setScrubPreview(displayedProgress)}
                      onBlur={() => {
                        const preview = scrubPreviewRef.current;
                        if (
                          preview !== null &&
                          Math.abs(preview - progressRef.current) > 0.5
                        ) {
                          handleScrubCommit(preview);
                          return;
                        }
                        setScrubPreview(null);
                      }}
                      className="absolute inset-x-0 top-1/2 z-[3] h-5 w-full -translate-y-1/2 border-2 border-transparent bg-transparent p-0"
                    />
                  </div>
                </div>

                <span
                  className={cn(
                    "shrink-0 font-mono text-xs tabular-nums text-white/85",
                    usesNativePlayer && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]",
                  )}
                >
                  {formatDuration(displayedAbsoluteTime * 1000)}
                  {totalDurationSeconds > 0 && (
                    <> / {formatDuration(totalDurationSeconds * 1000)}</>
                  )}
                </span>
              </div>

              <div
                data-tv-row=""
                data-tv-content-row=""
                data-tv-watch-controls=""
                data-tv-watch-transport-row=""
                className="flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <TvFocusButton
                    variant="watch"
                    onClick={() => skipRelative(-10)}
                    aria-label="Back 10 seconds"
                    className={controlIconButtonClassName}
                  >
                    <span className="watch-control-icon">
                      <SkipBack size={24} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                    </span>
                  </TvFocusButton>

                  <TvFocusButton
                    ref={playButtonRef}
                    variant="watch"
                    onClick={togglePlay}
                    className={controlIconButtonClassName}
                    aria-label={bufferingMidPlayback ? "Buffering" : isPlaying ? "Pause" : "Play"}
                  >
                    <span
                      className={cn(
                        "watch-control-icon",
                        !bufferingMidPlayback && !isPlaying && "watch-control-icon--play",
                      )}
                    >
                      {bufferingMidPlayback ? (
                        <Loader2 size={24} strokeWidth={2} absoluteStrokeWidth className="animate-spin" aria-hidden />
                      ) : isPlaying ? (
                        <Pause size={24} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                      ) : (
                        <Play size={24} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                      )}
                    </span>
                  </TvFocusButton>

                  <TvFocusButton
                    variant="watch"
                    onClick={() => skipRelative(30)}
                    aria-label="Forward 30 seconds"
                    className={controlIconButtonClassName}
                  >
                    <span className="watch-control-icon">
                      <SkipForward size={24} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                    </span>
                  </TvFocusButton>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <VideoDisplayModeButton
                    variant="tv"
                    mode={videoDisplayMode}
                    onCycle={cycleVideoDisplayModeSetting}
                    className={controlIconButtonClassName}
                  />

                  <div className="relative">
                    <TvFocusButton
                      variant="watch"
                      selected={activeSubtitle !== null}
                      aria-label={activeSubtitle === null ? "Subtitles off" : "Subtitles on"}
                      onClick={() => {
                        setQualityMenuOpen(false);
                        setSubtitleAppearanceOpen(false);
                        setSubtitleMenuOpen((open) => {
                          if (!open) rememberMenuFocus();
                          return !open;
                        });
                        revealControls(false);
                      }}
                      className={controlIconButtonClassName}
                    >
                      <span className="watch-control-icon">
                        <Subtitles size={24} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                      </span>
                    </TvFocusButton>
                    {subtitleMenuOpen && (
                      <TvWatchPopover className="w-[min(32rem,calc(100vw-2rem))]">
                        {subtitleAppearanceOpen ? (
                          <TvSubtitleAppearancePanel nativePlayback={usesNativePlayer} />
                        ) : (
                          <TvWatchMenuList>
                            {subtitleListError ? (
                              <p className="px-3 py-1.5 text-sm text-red-400">{subtitleListError}</p>
                            ) : subtitles.length === 0 ? (
                              <p className="px-3 py-1.5 text-sm text-muted-foreground">
                                None available
                              </p>
                            ) : (
                              <TvFocusButton
                                variant="default"
                                selected={activeSubtitle === null}
                                onClick={() => {
                                  selectSubtitleOnNative(null);
                                  closeMenus();
                                  revealControls(false);
                                }}
                                className={tvWatchPopoverOptionClassName()}
                              >
                                Off
                              </TvFocusButton>
                            )}
                            {subtitles.map((sub) => (
                              <div key={sub.id} className="flex items-start gap-1 rounded px-1 py-0.5">
                                <TvFocusButton
                                  variant="default"
                                  selected={activeSubtitle === sub.id}
                                  onClick={() => {
                                    selectSubtitleOnNative(sub.id);
                                    closeMenus();
                                    revealControls(false);
                                  }}
                                  className={tvWatchPopoverOptionClassName("min-w-0 flex-1")}
                                >
                                  {formatSubtitleLabel(sub)}
                                </TvFocusButton>
                                {sub.source === "opensubtitles" ? (
                                  <TvFocusButton
                                    variant="default"
                                    onClick={() => {
                                      void removeSubtitleTrack(sub.id);
                                    }}
                                    className="mt-1 shrink-0 rounded px-2 py-1 text-xs text-muted-foreground"
                                  >
                                    Remove
                                  </TvFocusButton>
                                ) : null}
                              </div>
                            ))}
                            <div className="my-1 border-t border-border" />
                            <TvFocusButton
                              variant="default"
                              onClick={() => setSubtitleAppearanceOpen(true)}
                              className={tvWatchPopoverOptionClassName()}
                            >
                              Customize appearance…
                            </TvFocusButton>
                            <div className="my-1 border-t border-border" />
                            {opensubtitlesConfigured ? (
                              <TvFocusButton
                                variant="default"
                                onClick={() => {
                                  rememberMenuFocus();
                                  setSubtitleMenuOpen(false);
                                  setSubtitleAppearanceOpen(false);
                                  setQualityMenuOpen(false);
                                  setPanelOpen(false);
                                  setSubtitleSearchOpen(true);
                                }}
                                className={tvWatchPopoverOptionClassName()}
                              >
                                Search online…
                              </TvFocusButton>
                            ) : null}
                          </TvWatchMenuList>
                        )}
                      </TvWatchPopover>
                    )}
                  </div>

                  <div className="relative">
                    <TvFocusButton
                      variant="watch"
                      aria-label={`Quality: ${qualityLabel(quality, sourceHeight, sourceWidth)}`}
                      onClick={() => {
                        setSubtitleMenuOpen(false);
                        setSubtitleAppearanceOpen(false);
                        setQualityMenuOpen((open) => {
                          if (!open) rememberMenuFocus();
                          return !open;
                        });
                        revealControls(false);
                      }}
                      disabled={!transcodingEnabled && quality === "original"}
                      className={controlLabelButtonClassName}
                    >
                      <span className="watch-control-icon">
                        <Settings2 size={24} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                      </span>
                      <span className="watch-control-label">
                        {qualityLabel(quality, sourceHeight, sourceWidth)}
                      </span>
                    </TvFocusButton>
                    {qualityMenuOpen && (
                      <TvWatchPopover className="w-[min(20rem,calc(100vw-2rem))]">
                        <TvWatchMenuList>
                          {availableQualities.map((option) => (
                            <TvFocusButton
                              key={option}
                              variant="default"
                              selected={quality === option}
                              disabled={option !== "original" && !transcodingEnabled}
                              onClick={() => {
                                changeQuality(option);
                                closeMenus();
                                revealControls(false);
                              }}
                              className={tvWatchPopoverOptionClassName(
                                option !== "original" &&
                                  !transcodingEnabled &&
                                  "cursor-not-allowed opacity-50",
                              )}
                            >
                              {qualityLabel(option, sourceHeight, sourceWidth)}
                            </TvFocusButton>
                          ))}
                        </TvWatchMenuList>
                      </TvWatchPopover>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <SubtitleSearchDialog
        tv
        open={subtitleSearchOpen}
        onClose={() => {
          setSubtitleSearchOpen(false);
          requestAnimationFrame(() => {
            const target = menuReturnFocusRef.current;
            menuReturnFocusRef.current = null;
            if (target?.isConnected) focusTvItem(target);
          });
        }}
        fileId={fileId}
        type={type}
        opensubtitlesConfigured={opensubtitlesConfigured}
        onDownloaded={(track) => {
          selectSubtitleOnNative(track.id);
          void refreshSubtitles(track);
          setSubtitleSearchOpen(false);
          requestAnimationFrame(() => {
            const target = menuReturnFocusRef.current;
            menuReturnFocusRef.current = null;
            if (target?.isConnected) focusTvItem(target);
          });
        }}
      />
    </div>
  );
}
