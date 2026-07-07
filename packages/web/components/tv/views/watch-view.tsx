"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type Hls from "hls.js";
import { Loader2, Pause, Play, Settings2, SkipBack, SkipForward, Subtitles } from "lucide-react";
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
import { notifyWebPlaybackSourceReady } from "@/lib/web-subtitle-attach";
import { usePlaybackVisibility } from "@/lib/use-playback-visibility";
import { useVideoPlaybackEvents } from "@/lib/use-video-playback-events";
import { useSubtitleTracks } from "@/lib/use-subtitle-tracks";
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
  TvWatchMenuPanel,
  TvWatchMenuSectionLabel,
  tvWatchMenuOptionClassName,
} from "@/components/tv/tv-watch-settings-menu";
import { focusTvItem } from "@/lib/tv-focus";
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

export function TvWatchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") ?? "movie") as "movie" | "episode";
  const fileId = parseInt(searchParams.get("id") ?? "", 10);
  const mediaId = searchParams.get("media");
  const posterFromUrl = searchParams.get("poster");
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
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef(0);
  const currentTimeRef = useRef(0);
  const nativeSubtitleInitializedRef = useRef(false);
  const activeSubtitleRef = useRef<number | null>(null);
  const streamInfoRef = useRef<StreamInfo | null>(null);
  const titleRef = useRef("");
  const playbackStreamRef = useRef<ReturnType<typeof resolvePlaybackStream> | null>(null);
  const playbackFatalHandledRef = useRef(-1);
  const nativePlaySessionRef = useRef(0);
  const nativeErrorHandledSessionRef = useRef(0);
  const nativeWasPlayingRef = useRef(false);
  const nativeIsPlayingRef = useRef(false);
  const nativePausedAtRef = useRef<number | null>(null);
  const nativeHlsRecoveryAttemptsRef = useRef(0);
  const startNextEpisodeCountdownRef = useRef<() => void>(() => {});
  const controlsRevealedAtRef = useRef<number | null>(null);

  const TV_CONTROLS_AUTO_HIDE_MS = 3_000;
  /** Only hide transport chrome on Back if the user opened it within this window. */
  const TV_CONTROLS_BACK_DISMISS_MS = 4_000;

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
  const [posterPath, setPosterPath] = useState<string | null>(posterFromUrl);
  const [mediaDetail, setMediaDetail] = useState<PlaybackMediaDetail | null>(null);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [initialResumeSeconds, setInitialResumeSeconds] = useState<number | null>(null);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [subtitleAppearanceOpen, setSubtitleAppearanceOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [subtitleSearchOpen, setSubtitleSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [playbackHasBegun, setPlaybackHasBegun] = useState(false);
  const [scrubPreviewPercent, setScrubPreviewPercent] = useState<number | null>(null);
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

  const {
    subtitles,
    activeSubtitle,
    setActiveSubtitle: selectWebSubtitle,
    prefetchMenuTracks,
    refreshSubtitles,
    opensubtitlesConfigured,
  } = useSubtitleTracks(
    fileId,
    type,
    videoRef,
    streamGeneration,
    usingHlsPlayback ? hlsStartOffset : 0,
  );

  const selectSubtitle = useCallback(
    (subtitleId: number | null) => {
      if (usesNativePlayer) {
        const offset = usingHlsRef.current ? hlsStartOffsetRef.current : 0;
        const subtitleUrl =
          subtitleId != null
            ? toAbsoluteMediaUrl(api.subtitleUrl(subtitleId, offset))
            : undefined;
        updateNativeSubtitles(subtitleUrl);
      }
      selectWebSubtitle(subtitleId);
    },
    [selectWebSubtitle, usesNativePlayer],
  );

  useEffect(() => {
    if (!subtitleMenuOpen) return;
    prefetchMenuTracks();
  }, [subtitleMenuOpen, prefetchMenuTracks]);

  const posterUrl = tvImageUrl(posterPath);

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
      document.documentElement.removeAttribute("data-native-video");
      setNativeWebOverlayAlpha(1);
      stopNativePlayback();
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
  const showLoadingOverlay =
    !error &&
    !(!usingHlsPlayback && optimisticAbsoluteSeconds !== null) &&
    (isPreparing || (buffering && !playbackHasBegun));
  const centerMessageVisible = Boolean(error || countdown || showLoadingOverlay);

  const captureStreamRestartPosition = useCallback(() => {
    const absoluteTime = usingHlsRef.current
      ? hlsStartOffsetRef.current + currentTimeRef.current
      : currentTimeRef.current;
    if (absoluteTime > 0) {
      setStreamStartSeconds(absoluteTime);
    }
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
        setScrubPreviewPercent(progressRef.current);
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
      setScrubPreviewPercent(progressRef.current);
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
      ? hlsStartOffsetRef.current + currentTime
      : currentTime;

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

  useEffect(() => {
    if (!usesNativePlayer) return;

    document.documentElement.setAttribute("data-native-video", "true");
    prepareNativeVideoOverlay();
    return registerNativePlayerHandlers({
      onState: (state) => {
        setCurrentTime(state.currentTime);
        if (state.duration > 0) setDuration(state.duration);
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
        const offset = hlsStartOffsetRef.current;
        if (usingHlsRef.current) {
          setBufferedRanges([{ start: offset, end: offset + state.buffered }]);
        } else {
          setBufferedRanges([{ start: 0, end: state.buffered }]);
        }
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
        setIsPlaying(false);
        saveProgressRef.current();
        startNextEpisodeCountdownRef.current();
      },
    });
  }, [usesNativePlayer, captureStreamRestartPosition, restartNativeHlsAtCurrentPosition]);

  useEffect(() => {
    if (!usesNativePlayer) return;
    return () => {
      document.documentElement.removeAttribute("data-native-video");
      setNativeWebOverlayAlpha(1);
      stopNativePlayback();
    };
  }, [usesNativePlayer]);

  useEffect(() => {
    setStreamStartSeconds(null);
    setStreamGeneration(0);
    setForceRemux(false);
    nativeRemuxFallbackRef.current = false;
    nativeTranscodeFallbackRef.current = false;
    nativeHlsRecoveryAttemptsRef.current = 0;
    nativePausedAtRef.current = null;
    nativeIsPlayingRef.current = false;
    nativePlaySessionRef.current = 0;
    nativeErrorHandledSessionRef.current = 0;
    nativeSubtitleInitializedRef.current = false;
    activeSubtitleRef.current = null;
    menuReturnFocusRef.current = null;
    setShowControls(true);
    setPlaybackHasBegun(false);
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
  }, [centerMessageVisible, isPlaying, panelOpen, scheduleControlsAutoHide]);

  useEffect(() => {
    setPosterPath(posterFromUrl);
  }, [fileId, type, posterFromUrl]);

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
            setInitialResumeSeconds(positionMs / 1000);
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

    const startAt = streamStartSeconds ?? initialResumeSeconds ?? 0;
    const stream = resolvePlaybackStream(quality, streamInfo, { forceRemux });
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

      nativePlaySessionRef.current += 1;
      nativeErrorHandledSessionRef.current = nativePlaySessionRef.current - 1;

      startNativePlayback({
        url: toAbsoluteMediaUrl(relativeUrl),
        title: titleRef.current || "MEDIA!",
        fileId,
        itemType: type === "movie" ? "movie" : "episode",
        startSeconds: usingHls ? 0 : startAt,
        durationMs: sourceDurationMs || streamInfo.durationMs || 0,
        isHls: usingHls,
        isHdr: needsHdrToneMap(streamInfo.dynamicRange),
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
        if (usingHls) {
          void api.stopStream(fileId, type).catch(() => {});
        }
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
          onBufferUpdate: updateBufferedPosition,
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
      if (usingHls) {
        void api.stopStream(fileId, type).catch(() => {});
      }
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
    sourceDurationMs,
    usesNativePlayer,
    forceRemux,
  ]);

  useEffect(() => {
    if (!usesNativePlayer || !streamInfo || initialResumeSeconds === null || !fileId) {
      return;
    }

    if (!nativeSubtitleInitializedRef.current) {
      nativeSubtitleInitializedRef.current = true;
      activeSubtitleRef.current = activeSubtitle;
      return;
    }

    if (activeSubtitleRef.current === activeSubtitle) return;
    activeSubtitleRef.current = activeSubtitle;

    const stream = resolvePlaybackStream(quality, streamInfo, { forceRemux });
    const usingHls = stream.usingHls;
    const relativeTime = currentTimeRef.current;
    const absoluteTime = usingHls
      ? hlsStartOffsetRef.current + relativeTime
      : relativeTime;
    const subtitleOffset = usingHls ? hlsStartOffsetRef.current : 0;

    const subtitleUrl =
      activeSubtitle != null
        ? toAbsoluteMediaUrl(api.subtitleUrl(activeSubtitle, subtitleOffset))
        : undefined;

    if (updateNativeSubtitles(subtitleUrl)) {
      return;
    }

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

    startNativePlayback({
      url: toAbsoluteMediaUrl(relativeUrl),
      title: titleRef.current || "MEDIA!",
      fileId,
      itemType: type === "movie" ? "movie" : "episode",
      startSeconds: usingHls ? 0 : absoluteTime,
      durationMs: sourceDurationMs || streamInfo.durationMs || 0,
      isHls: usingHls,
      isHdr: needsHdrToneMap(streamInfo.dynamicRange),
      subtitleUrl,
    });

    if (usingHls && relativeTime > 0) {
      seekNativePlayback(relativeTime * 1000);
    }
  }, [
    activeSubtitle,
    usesNativePlayer,
    streamInfo,
    initialResumeSeconds,
    fileId,
    type,
    quality,
    forceRemux,
    streamGeneration,
    sourceDurationMs,
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

  const absoluteCurrentTime =
    usingHlsPlayback ? hlsStartOffsetRef.current + currentTime : currentTime;
  const absoluteDurationMs = sourceDurationMs || duration * 1000;
  const totalDurationSeconds =
    absoluteDurationMs > 0 ? absoluteDurationMs / 1000 : 0;
  const displayedAbsoluteTime =
    optimisticAbsoluteSeconds !== null ? optimisticAbsoluteSeconds : absoluteCurrentTime;
  const progress =
    absoluteDurationMs > 0 ? (displayedAbsoluteTime * 1000) / absoluteDurationMs * 100 : 0;
  progressRef.current = progress;
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

  const resumeStoppedHlsPlayback = useCallback(() => {
    captureStreamRestartPosition();
    setStreamGeneration((generation) => generation + 1);
    setBuffering(true);
  }, [captureStreamRestartPosition]);

  usePlaybackVisibility({
    enabled: Boolean(fileId && !Number.isNaN(fileId)),
    videoRef,
    hlsRef,
    fileId,
    type: type === "movie" ? "movie" : "episode",
    usingHlsPlayback,
    usesNativePlayer,
    onSaveProgress: saveProgress,
    onResumeStoppedHls: resumeStoppedHlsPlayback,
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
    if (!subtitleMenuOpen && !subtitleAppearanceOpen && !qualityMenuOpen) return;
    requestAnimationFrame(() => {
      const panel = document.querySelector("[data-tv-watch-menu]");
      const first = panel?.querySelector<HTMLElement>("[data-tv-item]");
      if (first) focusTvItem(first);
    });
  }, [subtitleMenuOpen, subtitleAppearanceOpen, qualityMenuOpen]);

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

  const showPosterBackdrop =
    Boolean(posterUrl) && !playbackHasBegun && !error;
  const showBufferingBar =
    bufferingMidPlayback && playbackHasBegun && !error;
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
  const showTransportControls = Boolean(
    streamInfo && initialResumeSeconds !== null && !error && !countdown,
  );

  useEffect(() => {
    if (!centerMessageVisible) return;
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setShowControls(false);
    releaseWatchFocus();
  }, [centerMessageVisible, releaseWatchFocus]);

  useEffect(() => {
    if (!usesNativePlayer) return;
    // Only raise the WebView layer when controls/messages need it — not during
    // mid-playback buffering, which was dimming HDR video on Android TV.
    setNativeWebOverlayAlpha(
      controlsVisible || centerMessageVisible ? 1 : 0,
    );
  }, [usesNativePlayer, controlsVisible, centerMessageVisible]);

  const timelinePreviewPercent = scrubPreviewPercent ?? progress;
  const timelinePreviewMs =
    totalDurationSeconds > 0
      ? (timelinePreviewPercent / 100) * totalDurationSeconds * 1000
      : 0;
  const showScrubPreview =
    showTransportControls &&
    scrubPreviewPercent !== null &&
    totalDurationSeconds > 0;

  const seekPreviewMaxWidth = isTv4KClient() ? 220 : 160;

  const controlButtonClassName =
    "tv-watch-control flex min-h-11 items-center justify-center rounded-lg text-white";

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
    const controlsRecentlyRevealed =
      showControls &&
      controlsRevealedAtRef.current !== null &&
      Date.now() - controlsRevealedAtRef.current < TV_CONTROLS_BACK_DISMISS_MS;
    if (controlsRecentlyRevealed) {
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
    showControls,
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
          if (totalDurationSeconds > 0) {
            const next = Math.max(
              0,
              (optimisticAbsoluteSeconds ?? displayedAbsoluteTime) - 30,
            );
            setScrubPreviewPercent((next / totalDurationSeconds) * 100);
          }
          skipRelative(-30);
          return;
        }
        if (e.key === "ArrowRight" || e.key === "MediaFastForward") {
          e.preventDefault();
          if (totalDurationSeconds > 0) {
            const next = Math.min(
              totalDurationSeconds,
              (optimisticAbsoluteSeconds ?? displayedAbsoluteTime) + 30,
            );
            setScrubPreviewPercent((next / totalDurationSeconds) * 100);
          }
          skipRelative(30);
          return;
        }
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
          skipRelative(-30);
        } else if (e.key === "MediaFastForward") {
          skipRelative(30);
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
    handleWatchBack,
    panelOpen,
    subtitleSearchOpen,
    closeMenus,
    revealControls,
    centerMessageVisible,
    controlsVisible,
    showTransportControls,
    totalDurationSeconds,
    optimisticAbsoluteSeconds,
    displayedAbsoluteTime,
    focusScrubControl,
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
            <div
              className={cn(
                "pointer-events-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-8",
                usesNativePlayer ? "bg-transparent" : "watch-chrome-bottom",
              )}
            >
              <div className="mb-2 flex items-end justify-between gap-3">
                <div
                  data-tv-row=""
                  data-tv-content-row=""
                  data-tv-watch-controls=""
                  data-tv-watch-scrub-row=""
                  className="group/watch-scrub min-w-0 flex-1 py-1.5"
                >
                  <div className="relative">
                    {showScrubPreview && (
                      <div className="mb-2 flex w-full max-w-full items-end justify-center">
                        <SeekPreviewTooltip
                          variant="inline"
                          maxThumbWidth={seekPreviewMaxWidth}
                          percent={timelinePreviewPercent}
                          timeMs={timelinePreviewMs}
                          cue={lookupCue(timelinePreviewMs)}
                          spriteUrl={thumbnails?.spriteUrl ?? null}
                        />
                      </div>
                    )}
                    <TvFocusButton
                      ref={scrubButtonRef}
                      data-tv-watch-scrub=""
                      aria-label="Progress"
                      onClick={() => revealControls(false)}
                      onFocus={() => setScrubPreviewPercent(progress)}
                      onBlur={() => setScrubPreviewPercent(null)}
                      className="tv-watch-scrub relative flex h-7 w-full items-center overflow-visible border-2 border-transparent bg-transparent p-0 px-1.5"
                    >
                      <div className="watch-scrub-track w-full">
                        {bufferedRanges.map((range, index) => {
                          const left = toTimelinePercent(range.start);
                          const width = Math.max(0, toTimelinePercent(range.end) - left);
                          if (width <= 0) return null;
                          return (
                            <div
                              key={index}
                              className="watch-scrub-buffer"
                              style={{ left: `${left}%`, width: `${width}%` }}
                            />
                          );
                        })}
                        <div
                          className={cn(
                            "watch-scrub-progress",
                            progress >= 99.5 ? "rounded-full" : "rounded-l-full",
                            optimisticAbsoluteSeconds === null && "transition-[width] duration-150",
                          )}
                          style={{ width: `${Math.min(100, progress)}%` }}
                        />
                        <div
                          className="watch-scrub-playhead"
                          style={{ left: `${Math.min(100, Math.max(0, progress))}%` }}
                        />
                      </div>
                    </TvFocusButton>
                  </div>
                </div>

                <span
                  className={cn(
                    "shrink-0 font-mono text-xs tabular-nums text-white/90",
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
                className="flex items-center gap-2 py-0.5"
              >
                <TvFocusButton
                  variant="nav"
                  onClick={() => skipRelative(-10)}
                  aria-label="Back 10 seconds"
                  className={cn("h-12 w-12", controlButtonClassName)}
                >
                  <SkipBack className="h-5 w-5" />
                </TvFocusButton>

                <TvFocusButton
                  ref={playButtonRef}
                  variant="nav"
                  onClick={togglePlay}
                  className={cn("h-14 w-14", controlButtonClassName)}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause className="h-6 w-6" />
                  ) : (
                    <Play className="h-6 w-6 fill-current" />
                  )}
                </TvFocusButton>

                <TvFocusButton
                  variant="nav"
                  onClick={() => skipRelative(30)}
                  aria-label="Forward 30 seconds"
                  className={cn("h-12 w-12", controlButtonClassName)}
                >
                  <SkipForward className="h-5 w-5" />
                </TvFocusButton>

                <VideoDisplayModeButton
                  variant="tv"
                  mode={videoDisplayMode}
                  onCycle={cycleVideoDisplayModeSetting}
                  className={cn("h-12 w-12", controlButtonClassName)}
                />

                <TvFocusButton
                  variant="nav"
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
                  className={cn(
                    "h-12 min-w-[5.5rem] gap-1.5 px-3",
                    controlButtonClassName,
                    activeSubtitle !== null && "text-primary",
                  )}
                >
                  <Subtitles className="h-4 w-4" />
                  <span className="text-xs font-medium">Subs</span>
                </TvFocusButton>

                <TvFocusButton
                  variant="nav"
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
                  className={cn("h-12 min-w-[7rem] gap-1.5 px-3", controlButtonClassName)}
                >
                  <Settings2 className="h-4 w-4" />
                  <span className="max-w-32 truncate text-xs font-medium">
                    {qualityLabel(quality, sourceHeight, sourceWidth)}
                  </span>
                </TvFocusButton>
              </div>
            </div>
          </div>
        )}
      </div>

      {subtitleMenuOpen && (
        <TvWatchMenuPanel
          title="Subtitles"
          description={
            activeSubtitle !== null
              ? "Subtitles on"
              : subtitles.length > 0
                ? `${subtitles.length} track${subtitles.length === 1 ? "" : "s"} available`
                : undefined
          }
          onBack={() => {
            closeMenus();
            revealControls(false);
          }}
        >
          <TvWatchMenuList>
            <TvWatchMenuSectionLabel>Track</TvWatchMenuSectionLabel>
            <TvFocusButton
              variant="card"
              selected={activeSubtitle === null}
              onClick={() => selectSubtitle(null)}
              className={tvWatchMenuOptionClassName()}
            >
              Off
            </TvFocusButton>
            {subtitles.map((sub) => (
              <TvFocusButton
                key={sub.id}
                variant="card"
                selected={activeSubtitle === sub.id}
                onClick={() => selectSubtitle(sub.id)}
                className={tvWatchMenuOptionClassName("flex items-center justify-between gap-3")}
              >
                <span className="min-w-0 truncate">{formatSubtitleLabel(sub)}</span>
                {sub.source === "opensubtitles" ? (
                  <span className="shrink-0 text-xs text-muted-foreground">Online</span>
                ) : null}
              </TvFocusButton>
            ))}
            {subtitles.length === 0 && !opensubtitlesConfigured ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                No subtitles found. Configure OpenSubtitles on the desktop site to search online.
              </p>
            ) : null}

            <TvWatchMenuSectionLabel>More</TvWatchMenuSectionLabel>
            <TvFocusButton
              variant="card"
              onClick={() => {
                setSubtitleMenuOpen(false);
                setSubtitleAppearanceOpen(true);
              }}
              className={tvWatchMenuOptionClassName("text-primary")}
            >
              Customize appearance
            </TvFocusButton>
            {opensubtitlesConfigured ? (
              <TvFocusButton
                variant="card"
                onClick={() => {
                  rememberMenuFocus();
                  setSubtitleMenuOpen(false);
                  setSubtitleAppearanceOpen(false);
                  setQualityMenuOpen(false);
                  setPanelOpen(false);
                  setSubtitleSearchOpen(true);
                }}
                className={tvWatchMenuOptionClassName("text-primary")}
              >
                Search online
              </TvFocusButton>
            ) : null}
          </TvWatchMenuList>
        </TvWatchMenuPanel>
      )}

      {subtitleAppearanceOpen && (
        <TvWatchMenuPanel
          title="Subtitle appearance"
          onBack={() => {
            setSubtitleAppearanceOpen(false);
            setSubtitleMenuOpen(true);
          }}
        >
          <TvSubtitleAppearancePanel nativePlayback={usesNativePlayer} />
        </TvWatchMenuPanel>
      )}

      {qualityMenuOpen && (
        <TvWatchMenuPanel
          title="Quality"
          description={qualityLabel(quality, sourceHeight, sourceWidth)}
          onBack={() => {
            closeMenus();
            revealControls(false);
          }}
        >
          <TvWatchMenuList>
            {availableQualities.map((option) => (
              <TvFocusButton
                key={option}
                variant="card"
                selected={quality === option}
                disabled={option !== "original" && !transcodingEnabled}
                onClick={() => changeQuality(option)}
                className={tvWatchMenuOptionClassName(
                  option !== "original" && !transcodingEnabled ? "opacity-40" : undefined,
                )}
              >
                {qualityLabel(option, sourceHeight, sourceWidth)}
              </TvFocusButton>
            ))}
          </TvWatchMenuList>
        </TvWatchMenuPanel>
      )}

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
          selectSubtitle(track.id);
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
