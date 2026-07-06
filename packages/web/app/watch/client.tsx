"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import type Hls from "hls.js";
import {
  ArrowLeft,
  Info,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Subtitles,
  Settings2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api, type StreamInfo, type StreamQuality } from "@/lib/api";
import { routes } from "@/lib/routes";
import {
  getVideoBufferedRanges,
  getVideoSeekableEnd,
  resolveInitialStreamQuality,
  resolvePlaybackStream,
  buildPlaybackTitle,
  findEpisode,
  type PlaybackMediaDetail,
} from "@/lib/playback-utils";
import { destroyHlsInstance, loadHls, startWebPlayback } from "@/lib/playback-engine";
import { usePlaybackVisibility } from "@/lib/use-playback-visibility";
import { useMediaSession } from "@/lib/use-media-session";
import { useVideoPlaybackEvents } from "@/lib/use-video-playback-events";
import { useSeekThumbnails } from "@/lib/use-seek-thumbnails";
import { SeekPreviewTooltip } from "@/components/seek-preview-tooltip";
import { useNextEpisodeCountdown } from "@/lib/use-next-episode-countdown";
import { NextEpisodeCountdownOverlay } from "@/components/next-episode-countdown";
import { cn, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CastButton } from "@/components/cast-button";
import { PlaybackPosterBackdrop } from "@/components/playback-poster-backdrop";
import { TvCastButton, type TvCastPayload } from "@/components/tv-cast-button";
import { SubtitleSearchDialog } from "@/components/subtitle-search-dialog";
import { SubtitleAppearanceSettingsLink } from "@/components/subtitle-style-settings";
import { FileDetailsDialog } from "@/components/file-details-dialog";
import { VideoDisplayModeButton } from "@/components/video-display-mode-button";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTvMode } from "@/lib/tv-mode";
import { TvWatchView } from "@/components/tv/views/watch-view";
import { resolveFallbackQuality, qualityLabel } from "@/lib/watch-helpers";
import {
  cycleVideoDisplayMode,
  loadVideoDisplayMode,
  saveVideoDisplayMode,
  videoDisplayModeClass,
  type VideoDisplayMode,
} from "@/lib/video-display-mode";

interface SubtitleTrack {
  id: number;
  language: string;
  label?: string | null;
  source?: "external" | "embedded" | "opensubtitles";
}

function formatSubtitleLabel(sub: SubtitleTrack): string {
  const sourceLabel =
    sub.source === "opensubtitles"
      ? "Online"
      : sub.source === "embedded"
        ? "Embedded"
        : "File";
  const detail = sub.label ? sub.label.slice(0, 48) : sourceLabel;
  return `${sub.language} · ${detail}`;
}

const VOLUME_STORAGE_KEY = "media:volume";
const PROGRESS_SAVE_MS = 10_000;

interface MediaDetail extends PlaybackMediaDetail {}

function loadStoredVolume(): number {
  if (typeof window === "undefined") return 1;
  const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (stored === null) return 1;
  const parsed = parseFloat(stored);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(1, parsed);
}

export function WatchClient() {
  const isTvMode = useTvMode();
  if (isTvMode) return <TvWatchView />;
  return <WatchDesktopClient />;
}

function WatchDesktopClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") ?? "movie") as "movie" | "episode";
  const fileId = parseInt(searchParams.get("id") ?? "", 10);
  const mediaId = searchParams.get("media");
  const posterFromUrl = searchParams.get("poster");
  const castStartSeconds = parseInt(searchParams.get("start") ?? "", 10);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsStartOffsetRef = useRef(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProgressRef = useRef<() => void>(() => {});
  const seekToAbsoluteRef = useRef<(seconds: number) => void>(() => {});
  const tryFallbackQualityRef = useRef<() => boolean>(() => false);
  const playbackStreamRef = useRef<ReturnType<typeof resolvePlaybackStream> | null>(null);
  const playbackFatalHandledRef = useRef(-1);
  const volumeBeforeMuteRef = useRef(1);

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
  const [sourceWidth, setSourceWidth] = useState<number | null>(null);
  const [transcodingEnabled, setTranscodingEnabled] = useState(true);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [bufferingMidPlayback, setBufferingMidPlayback] = useState(false);
  const [bufferedRanges, setBufferedRanges] = useState<Array<{ start: number; end: number }>>(
    [],
  );
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [subtitleSearchOpen, setSubtitleSearchOpen] = useState(false);
  const [opensubtitlesConfigured, setOpensubtitlesConfigured] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubPreview, setScrubPreview] = useState<number | null>(null);
  const [optimisticAbsoluteSeconds, setOptimisticAbsoluteSeconds] = useState<number | null>(
    null,
  );
  const [timelineHoverPercent, setTimelineHoverPercent] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [mediaDetail, setMediaDetail] = useState<PlaybackMediaDetail | null>(null);
  const [posterPath, setPosterPath] = useState<string | null>(posterFromUrl);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [playbackHasBegun, setPlaybackHasBegun] = useState(false);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [initialResumeSeconds, setInitialResumeSeconds] = useState<number | null>(null);
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

  const playbackStream = useMemo(
    () => resolvePlaybackStream(quality, streamInfo),
    [quality, streamInfo],
  );
  const usingHlsPlayback = playbackStream.usingHls;
  playbackStreamRef.current = playbackStream;
  const posterUrl = api.imageUrl(posterPath);
  const { thumbnails, lookupCue } = useSeekThumbnails(
    fileId,
    type === "movie" ? "movie" : "episode",
    Boolean(fileId && !Number.isNaN(fileId)),
  );

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

  const revealControls = useCallback((autoHide = true) => {
    setShowControls(true);
    if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current);
    }
    const video = videoRef.current;
    if (autoHide && video && !video.paused) {
      hideControlsTimer.current = setTimeout(() => {
        setShowControls(false);
        setSubtitleMenuOpen(false);
        setQualityMenuOpen(false);
        setVolumeMenuOpen(false);
        setDetailsOpen(false);
      }, 3000);
    }
  }, []);

  const setVolumeLevel = useCallback((level: number) => {
    const clamped = Math.min(1, Math.max(0, level));
    setVolume(clamped);
    setMuted(clamped === 0);
    localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    if (clamped > 0) {
      volumeBeforeMuteRef.current = clamped;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (muted || volume === 0) {
      const restore = volumeBeforeMuteRef.current || loadStoredVolume() || 1;
      setVolume(restore);
      setMuted(false);
      localStorage.setItem(VOLUME_STORAGE_KEY, String(restore));
      return;
    }

    volumeBeforeMuteRef.current = volume;
    setMuted(true);
  }, [muted, volume]);

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
      ? hlsStartOffsetRef.current + video.currentTime
      : video.currentTime;
    api.saveProgress({
      itemType: type === "movie" ? "movie" : "episode",
      itemId: fileId,
      positionMs: Math.floor(positionSeconds * 1000),
      durationMs,
    }).catch(() => {});
  }, [fileId, type, usingHlsPlayback, sourceDurationMs]);

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
      setQualityMenuOpen(false);
      setError(null);
      revealControls(true);
    },
    [revealControls, usingHlsPlayback, hlsStartOffset],
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
    setStreamStartSeconds(null);
    setStreamGeneration(0);
    setPlaybackHasBegun(false);
  }, [fileId, type]);

  useEffect(() => {
    const isPreparingPlayback = initialResumeSeconds === null || !streamInfo;
    if (!isPreparingPlayback && isPlaying && !buffering) {
      setPlaybackHasBegun(true);
    }
  }, [initialResumeSeconds, streamInfo, isPlaying, buffering]);

  useEffect(() => {
    setPosterPath(posterFromUrl);
  }, [fileId, type, posterFromUrl]);

  useEffect(() => {
    if (!fileId || Number.isNaN(fileId)) return;

    setInitialResumeSeconds(null);

    api
      .getStreamInfo(fileId, type === "movie" ? "movie" : "episode")
      .then((info) => {
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
        setError(initial.error);

        const positionMs = info.watchProgress?.positionMs ?? 0;
        const durationMs =
          info.watchProgress?.durationMs ?? info.durationMs ?? 0;
        const castStartMs =
          !Number.isNaN(castStartSeconds) && castStartSeconds > 0
            ? castStartSeconds * 1000
            : null;
        if (castStartMs !== null) {
          setInitialResumeSeconds(castStartMs / 1000);
          return;
        }
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
  }, [fileId, type, castStartSeconds]);

  useEffect(() => {
    setVolume(loadStoredVolume());
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = muted ? 0 : Math.max(volume, 0.01);
    video.muted = muted;
  }, [volume, muted]);

  const refreshSubtitles = useCallback(
    async (ensureTrack?: SubtitleTrack) => {
      if (!fileId || Number.isNaN(fileId)) return;
      try {
        const data = await api.listSubtitles(
          fileId,
          type === "movie" ? "movie" : "episode",
        );
        const tracks =
          ensureTrack && !data.tracks.some((track) => track.id === ensureTrack.id)
            ? [...data.tracks, ensureTrack]
            : data.tracks;
        setSubtitles(tracks);
        setActiveSubtitle((current) => {
          const keepId = current ?? ensureTrack?.id ?? null;
          if (keepId && tracks.some((track) => track.id === keepId)) {
            return keepId;
          }
          return null;
        });
        setOpensubtitlesConfigured(data.opensubtitlesConfigured);
      } catch (err) {
        console.warn("Failed to load subtitles", err);
      }
    },
    [fileId, type],
  );

  useEffect(() => {
    refreshSubtitles();
  }, [refreshSubtitles]);

  useEffect(() => {
    if (!fileId || Number.isNaN(fileId) || !mediaId) return;

    api
      .getMedia(parseInt(mediaId, 10))
      .then((data) => {
        const media = data as unknown as MediaDetail;
        setMediaDetail(media);
        setTitle(buildPlaybackTitle(type, media, fileId));

        if (type === "episode") {
          const episode = findEpisode(media, fileId);
          setPosterPath(episode?.stillPath ?? media.posterPath ?? null);
          return;
        }

        setPosterPath(media.posterPath ?? null);
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
    setBufferedRanges([]);
    setBufferingMidPlayback(false);

    if (hlsRef.current) {
      destroyHlsInstance(hlsRef.current);
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

    const sessionGen = streamGeneration;
    const onFatalError = () => {
      if (playbackFatalHandledRef.current === sessionGen) return;
      playbackFatalHandledRef.current = sessionGen;
      setOptimisticAbsoluteSeconds(null);
      setBuffering(false);
      if (tryFallbackQualityRef.current()) return;
      setError("Playback failed. Try a lower quality or Original.");
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
          onFatalError,
          onBufferUpdate: updateBufferedPosition,
          onSeekComplete: (seconds) => setCurrentTime(seconds),
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
      webPlayback?.cleanup();
      hlsRef.current = null;
      if (progressInterval.current) clearInterval(progressInterval.current);
      saveProgressRef.current();
      if (usingHls) {
        void api.stopStream(fileId, type).catch(() => {});
      }
    };
  }, [fileId, type, quality, streamGeneration, streamStartSeconds, initialResumeSeconds, streamInfo, updateBufferedPosition]);

  useEffect(() => {
    const onPageHide = () => {
      const video = videoRef.current;
      if (!video || !fileId) return;

      const durationMs = Math.floor(
        sourceDurationMs || (video.duration ? video.duration * 1000 : 0),
      );
      if (!durationMs) return;

      const positionSeconds = usingHlsPlayback
        ? hlsStartOffsetRef.current + video.currentTime
        : video.currentTime;

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
  }, [fileId, type, usingHlsPlayback, sourceDurationMs]);

  useVideoPlaybackEvents({
    videoRef,
    enabled: Boolean(fileId && !Number.isNaN(fileId)),
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
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || activeSubtitle === null) {
      video?.querySelectorAll("track").forEach((track) => track.remove());
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const activeTrack = subtitles.find((sub) => sub.id === activeSubtitle);

    const clearTracks = () => {
      video.querySelectorAll("track").forEach((track) => track.remove());
    };

    clearTracks();

    void (async () => {
      try {
        const res = await fetch(api.subtitleUrl(activeSubtitle), {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;

        const vtt = await res.text();
        if (cancelled || !vtt.trim()) return;

        objectUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
        if (cancelled) return;

        const track = document.createElement("track");
        track.kind = "subtitles";
        track.src = objectUrl;
        track.default = true;
        track.label = activeTrack?.language ?? "Subtitles";
        track.srclang = activeTrack?.language?.slice(0, 2) ?? "en";
        track.addEventListener("load", () => {
          if (track.track) track.track.mode = "showing";
        });
        video.appendChild(track);
        if (track.track) track.track.mode = "showing";
      } catch (err) {
        console.warn("Failed to load subtitle track", err);
      }
    })();

    return () => {
      cancelled = true;
      clearTracks();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeSubtitle, subtitles, streamGeneration]);

  const handleTvCast = useCallback(async (): Promise<TvCastPayload> => {
    const video = videoRef.current;
    const itemType = type === "movie" ? "movie" : "episode";
    return {
      fileId,
      type: itemType,
      title: title || undefined,
      posterPath,
      mediaId:
        mediaId && !Number.isNaN(parseInt(mediaId, 10))
          ? parseInt(mediaId, 10)
          : undefined,
      startTimeMs: video
        ? Math.floor(
            (usingHlsPlayback ? hlsStartOffset + video.currentTime : video.currentTime) *
              1000,
          )
        : 0,
    };
  }, [fileId, type, title, posterPath, mediaId, usingHlsPlayback, hlsStartOffset]);

  const handleCast = useCallback(async () => {
    const video = videoRef.current;
    const prepared = await api.prepareCast({
      fileId,
      type: type === "movie" ? "movie" : "episode",
      subtitleId: activeSubtitle ?? undefined,
      title: title || undefined,
      posterPath,
      startTimeMs: video
        ? Math.floor(
            (usingHlsPlayback ? hlsStartOffset + video.currentTime : video.currentTime) *
              1000,
          )
        : 0,
    });

    if (video) video.pause();

    return {
      contentUrl: prepared.contentUrl,
      contentType: prepared.contentType,
      title: prepared.title,
      posterUrl: prepared.posterUrl,
      subtitleUrl: prepared.subtitleUrl,
      subtitleLanguage: subtitles.find((s) => s.id === activeSubtitle)?.language,
      startTime: prepared.startTime,
    };
  }, [fileId, type, activeSubtitle, title, posterPath, subtitles, usingHlsPlayback, hlsStartOffset]);

  const absoluteCurrentTime =
    usingHlsPlayback ? hlsStartOffsetRef.current + currentTime : currentTime;
  const absoluteDurationMs = sourceDurationMs || duration * 1000;
  const totalDurationSeconds =
    absoluteDurationMs > 0 ? absoluteDurationMs / 1000 : 0;
  const progress =
    absoluteDurationMs > 0 ? (absoluteCurrentTime * 1000) / absoluteDurationMs * 100 : 0;
  const optimisticProgressPercent =
    optimisticAbsoluteSeconds !== null && absoluteDurationMs > 0
      ? ((optimisticAbsoluteSeconds * 1000) / absoluteDurationMs) * 100
      : null;
  const isOptimisticScrub = scrubPreview !== null || optimisticAbsoluteSeconds !== null;
  const displayedProgress = scrubPreview ?? optimisticProgressPercent ?? progress;
  const displayedAbsoluteTime =
    scrubPreview !== null && absoluteDurationMs > 0
      ? (scrubPreview / 100) * totalDurationSeconds
      : optimisticAbsoluteSeconds !== null
        ? optimisticAbsoluteSeconds
        : absoluteCurrentTime;
  const timelinePreviewPercent =
    scrubPreview ?? optimisticProgressPercent ?? timelineHoverPercent;
  const timelinePreviewMs =
    timelinePreviewPercent !== null && absoluteDurationMs > 0
      ? (timelinePreviewPercent / 100) * absoluteDurationMs
      : null;
  const toTimelinePercent = (seconds: number) =>
    absoluteDurationMs > 0
      ? Math.min(100, Math.max(0, ((seconds * 1000) / absoluteDurationMs) * 100))
      : 0;

  const seekToAbsolute = useCallback(
    (targetSeconds: number) => {
      const video = videoRef.current;
      if (!video || !totalDurationSeconds) return;

      const clamped = Math.max(0, Math.min(targetSeconds, totalDurationSeconds));
      setOptimisticAbsoluteSeconds(clamped);

      if (!usingHlsPlayback) {
        video.currentTime = clamped;
        revealControls(true);
        return;
      }

      const relativeTarget = clamped - hlsStartOffset;

      if (relativeTarget < 0) {
        setStreamStartSeconds(clamped);
        setStreamGeneration((current) => current + 1);
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
      setStreamGeneration((current) => current + 1);
      setBuffering(true);
      revealControls(true);
    },
    [
      totalDurationSeconds,
      usingHlsPlayback,
      hlsStartOffset,
      revealControls,
    ],
  );

  seekToAbsoluteRef.current = seekToAbsolute;

  usePlaybackVisibility({
    enabled: Boolean(fileId && !Number.isNaN(fileId)),
    videoRef,
    hlsRef,
    fileId,
    type: type === "movie" ? "movie" : "episode",
    usingHlsPlayback,
    onSaveProgress: saveProgress,
  });

  const seekToPercent = useCallback(
    (percent: number) => {
      if (!totalDurationSeconds) return;
      seekToAbsolute((percent / 100) * totalDurationSeconds);
    },
    [totalDurationSeconds, seekToAbsolute],
  );

  const skipRelative = useCallback(
    (deltaSeconds: number) => {
      seekToAbsolute(absoluteCurrentTime + deltaSeconds);
    },
    [absoluteCurrentTime, seekToAbsolute],
  );
  const isPreparing = initialResumeSeconds === null;
  const showPosterBackdrop = Boolean(posterUrl) && !playbackHasBegun && !error;
  const showInitialLoading =
    (isPreparing || (buffering && !playbackHasBegun)) &&
    !error &&
    !(!usingHlsPlayback && optimisticAbsoluteSeconds !== null);
  const showBufferingBar =
    bufferingMidPlayback && playbackHasBegun && !error && !showInitialLoading;
  const loadingMessage = isPreparing
    ? "Preparing playback..."
    : bufferingMidPlayback
      ? "Buffering..."
      : usingHlsPlayback && quality === "original"
        ? "Preparing original stream..."
        : usingHlsPlayback
          ? `Starting ${(playbackStream.hlsQuality ?? quality).toUpperCase()} stream...`
          : "Loading video...";

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

  useMediaSession({
    title,
    posterUrl,
    isPlaying,
    onPlay: () => {
      const video = videoRef.current;
      if (video?.paused) void video.play().catch(() => {});
    },
    onPause: () => videoRef.current?.pause(),
    onSeekBackward: () =>
      seekToAbsoluteRef.current(Math.max(0, absoluteCurrentTime - 10)),
    onSeekForward: () => seekToAbsoluteRef.current(absoluteCurrentTime + 10),
  });

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        seekToAbsoluteRef.current(
          (optimisticAbsoluteSeconds ?? absoluteCurrentTime) + 10,
        );
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekToAbsoluteRef.current(
          Math.max(0, (optimisticAbsoluteSeconds ?? absoluteCurrentTime) - 10),
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, absoluteCurrentTime, optimisticAbsoluteSeconds]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const handleScrubChange = (value: number) => {
    setOptimisticAbsoluteSeconds(null);
    setScrubPreview(value);
    revealControls(true);
  };

  const updateTimelineHover = useCallback(
    (clientX: number) => {
      const track = timelineRef.current;
      if (!track || !totalDurationSeconds) return;

      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;

      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      setTimelineHoverPercent(ratio * 100);
    },
    [totalDurationSeconds],
  );

  const handleScrubCommit = (value: number) => {
    setScrubPreview(null);
    setTimelineHoverPercent(null);
    seekToPercent(value);
  };

  if (!fileId || Number.isNaN(fileId)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="text-center">
          <p className="mb-4 text-muted-foreground">Invalid playback URL</p>
          <Button asChild>
            <Link href="/">Go Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-watch-player=""
      className="fixed inset-0 z-40 bg-black"
      onMouseMove={() => revealControls(true)}
      onTouchStart={() => revealControls(true)}
    >
      <PlaybackPosterBackdrop posterUrl={posterUrl} visible={showPosterBackdrop} />
      <video
        ref={videoRef}
        className={cn(
          "media-subtitles absolute inset-0 z-[2] h-full w-full",
          videoDisplayModeClass(videoDisplayMode),
        )}
        controls={false}
        playsInline
        preload={streamInfo ? "auto" : "metadata"}
        onClick={togglePlay}
      />

      {showInitialLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/70 px-5 py-3.5 text-sm text-white shadow-xl">
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
          onCancel={() => {
            cancelCountdown();
            router.push(backHref);
          }}
          onPlayNow={playNextEpisodeNow}
        />
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <p className="mb-4 text-red-400">{error}</p>
            <Button onClick={() => changeQuality("original")}>Try Original</Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "watch-controls-overlay absolute inset-0 z-20 flex flex-col justify-between",
          showControls && "watch-controls-visible",
        )}
      >
        <div className="watch-chrome-top pointer-events-auto px-4 pb-12 pt-4 sm:px-6 sm:pt-5">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="watch-control-btn shrink-0"
              asChild
            >
              <Link href={mediaId ? routes.media(parseInt(mediaId, 10)) : "/"}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-white drop-shadow-sm sm:text-lg">
                {title}
              </p>
              <p className="truncate text-xs text-white/60">
                {qualityLabel(quality, streamInfo?.height ?? null, streamInfo?.width ?? null)}
                {activeSubtitle !== null && " · Subtitles on"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="watch-control-btn shrink-0"
              onClick={() => {
                setDetailsOpen(true);
                setSubtitleMenuOpen(false);
                setQualityMenuOpen(false);
                setVolumeMenuOpen(false);
              }}
            >
              <Info className="h-4 w-4" />
              <span className="hidden sm:inline">Details</span>
            </Button>
          </div>
        </div>

        {showControls && !isPlaying && playbackHasBegun && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              className="watch-control-btn pointer-events-auto h-16 w-16 rounded-full bg-black/55 hover:bg-black/70"
              onClick={togglePlay}
              aria-label="Play"
            >
              <Play className="ml-0.5 h-9 w-9 fill-current" />
            </Button>
          </div>
        )}

        <div className="watch-chrome-bottom pointer-events-auto px-4 pb-4 pt-16 sm:px-6 sm:pb-5">
          <div className="mx-auto max-w-7xl">
            <div className="group/watch-scrub mb-3 flex items-center gap-3 sm:mb-4">
              <div
                ref={timelineRef}
                className="relative flex h-5 flex-1 items-center"
                onPointerMove={(e) => updateTimelineHover(e.clientX)}
                onPointerLeave={() => setTimelineHoverPercent(null)}
              >
                {timelinePreviewPercent !== null && timelinePreviewMs !== null && (
                  <SeekPreviewTooltip
                    percent={timelinePreviewPercent}
                    timeMs={timelinePreviewMs}
                    cue={lookupCue(timelinePreviewMs)}
                    spriteUrl={thumbnails?.spriteUrl ?? null}
                  />
                )}
                <div className="watch-scrub-track">
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
                      displayedProgress >= 99.5 ? "rounded-full" : "rounded-l-full",
                      !isOptimisticScrub && "transition-[width] duration-150",
                    )}
                    style={{ width: `${displayedProgress}%` }}
                  />
                  <div
                    className="watch-scrub-playhead"
                    style={{ left: `${Math.min(100, Math.max(0, displayedProgress))}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.1}
                  value={displayedProgress}
                  onChange={(e) => handleScrubChange(parseFloat(e.target.value))}
                  onPointerUp={(e) =>
                    handleScrubCommit(parseFloat((e.currentTarget as HTMLInputElement).value))
                  }
                  onMouseUp={(e) =>
                    handleScrubCommit(parseFloat((e.currentTarget as HTMLInputElement).value))
                  }
                  onTouchEnd={(e) =>
                    handleScrubCommit(parseFloat((e.currentTarget as HTMLInputElement).value))
                  }
                  aria-label="Progress"
                  className="range-signal range-signal-overlay absolute inset-0 z-[3] w-full cursor-pointer appearance-none bg-transparent"
                />
              </div>
              <span className="hidden shrink-0 font-mono text-xs tabular-nums text-white/85 sm:inline">
                {formatDuration(displayedAbsoluteTime * 1000)}
                {totalDurationSeconds > 0 && (
                  <> / {formatDuration(totalDurationSeconds * 1000)}</>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <div className="flex items-center gap-1 sm:gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="watch-control-btn"
                  onClick={() => skipRelative(-10)}
                  title="Back 10 seconds"
                >
                  <SkipBack className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="watch-control-btn"
                  onClick={togglePlay}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5 fill-current" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="watch-control-btn"
                  onClick={() => skipRelative(30)}
                  title="Forward 30 seconds"
                >
                  <SkipForward className="h-5 w-5" />
                </Button>

                <span className="ml-1 min-w-[4.5rem] font-mono text-xs tabular-nums text-white/75 sm:hidden">
                  {formatDuration(displayedAbsoluteTime * 1000)}
                </span>

                <div
                  className="relative hidden items-center sm:flex"
                  onMouseEnter={() => setVolumeMenuOpen(true)}
                  onMouseLeave={() => setVolumeMenuOpen(false)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="watch-control-btn"
                    onClick={toggleMute}
                    aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="h-5 w-5" />
                    ) : volume < 0.5 ? (
                      <Volume1 className="h-5 w-5" />
                    ) : (
                      <Volume2 className="h-5 w-5" />
                    )}
                  </Button>
                  <div
                    className={cn(
                      "flex items-center overflow-hidden transition-all duration-200",
                      volumeMenuOpen ? "ml-1 w-24 opacity-100" : "w-0 opacity-0",
                    )}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={muted ? 0 : Math.round(volume * 100)}
                      onChange={(e) =>
                        setVolumeLevel(parseFloat(e.target.value) / 100)
                      }
                      aria-label="Volume"
                      className="range-signal h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-primary"
                    />
                  </div>
                </div>

                <div className="relative sm:hidden">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="watch-control-btn"
                    onClick={() => setVolumeMenuOpen((open) => !open)}
                    aria-label={muted || volume === 0 ? "Unmute" : "Volume"}
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="h-5 w-5" />
                    ) : volume < 0.5 ? (
                      <Volume1 className="h-5 w-5" />
                    ) : (
                      <Volume2 className="h-5 w-5" />
                    )}
                  </Button>
                  {volumeMenuOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 rounded-md border border-border bg-card p-3 shadow-xl">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={muted ? 0 : Math.round(volume * 100)}
                        onChange={(e) =>
                          setVolumeLevel(parseFloat(e.target.value) / 100)
                        }
                        aria-label="Volume"
                        className="range-signal h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-white/20 accent-primary"
                      />
                      <button
                        type="button"
                        className="mt-2 block w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => {
                          toggleMute();
                          setVolumeMenuOpen(false);
                        }}
                      >
                        {muted || volume === 0 ? "Unmute" : "Mute"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <VideoDisplayModeButton
                  mode={videoDisplayMode}
                  onCycle={cycleVideoDisplayModeSetting}
                />

                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "watch-control-btn",
                      activeSubtitle !== null && "text-primary",
                    )}
                    onClick={() => {
                      setSubtitleMenuOpen((open) => !open);
                      setQualityMenuOpen(false);
                      setVolumeMenuOpen(false);
                    }}
                  >
                    <Subtitles className="h-4 w-4" />
                  </Button>
                  {subtitleMenuOpen && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 min-w-56 rounded-md border border-border bg-card p-1 shadow-xl">
                      {subtitles.length === 0 ? (
                        <p className="px-3 py-1.5 text-sm text-muted-foreground">
                          None available
                        </p>
                      ) : (
                        <button
                          className={cn(
                            "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-muted",
                            activeSubtitle === null && "bg-primary/10 text-primary",
                          )}
                          onClick={() => {
                            setActiveSubtitle(null);
                            setSubtitleMenuOpen(false);
                          }}
                        >
                          Off
                        </button>
                      )}
                      {subtitles.map((sub) => (
                        <div
                          key={sub.id}
                          className={cn(
                            "flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted",
                            activeSubtitle === sub.id && "bg-primary/10",
                          )}
                        >
                          <button
                            className={cn(
                              "min-w-0 flex-1 rounded px-2 py-1.5 text-left text-sm",
                              activeSubtitle === sub.id && "text-primary",
                            )}
                            onClick={() => {
                              setActiveSubtitle(sub.id);
                              setSubtitleMenuOpen(false);
                            }}
                          >
                            {formatSubtitleLabel(sub)}
                          </button>
                          {sub.source === "opensubtitles" && (
                            <button
                              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-red-400"
                              onClick={async () => {
                                await api.deleteSubtitle(sub.id);
                                if (activeSubtitle === sub.id) {
                                  setActiveSubtitle(null);
                                }
                                await refreshSubtitles();
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="my-1 border-t border-border" />
                      <SubtitleAppearanceSettingsLink
                        onNavigate={() => setSubtitleMenuOpen(false)}
                      />
                      <div className="my-1 border-t border-border" />
                      <button
                        className="block w-full rounded px-3 py-1.5 text-left text-sm text-primary hover:bg-muted"
                        onClick={() => {
                          setSubtitleMenuOpen(false);
                          setSubtitleSearchOpen(true);
                        }}
                      >
                        Search online...
                      </button>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="watch-control-btn"
                    onClick={() => {
                      setQualityMenuOpen((open) => !open);
                      setSubtitleMenuOpen(false);
                      setVolumeMenuOpen(false);
                    }}
                    disabled={!transcodingEnabled && quality === "original"}
                  >
                    <Settings2 className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {qualityLabel(quality, sourceHeight, sourceWidth)}
                    </span>
                  </Button>
                  {qualityMenuOpen && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 min-w-40 rounded-md border border-border bg-card p-1 shadow-xl">
                      {availableQualities.map((option) => (
                        <button
                          key={option}
                          className={cn(
                            "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-muted",
                            quality === option && "bg-primary/10 text-primary",
                            option !== "original" &&
                              !transcodingEnabled &&
                              "cursor-not-allowed opacity-50",
                          )}
                          disabled={option !== "original" && !transcodingEnabled}
                          onClick={() => changeQuality(option)}
                        >
                          {qualityLabel(option, sourceHeight, sourceWidth)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <CastButton onCast={handleCast} className="watch-control-btn" />

                <TvCastButton onCast={handleTvCast} className="watch-control-btn" />

                <Button
                  variant="ghost"
                  size="icon"
                  className="watch-control-btn"
                  onClick={toggleFullscreen}
                >
                  {isFullscreen ? (
                    <Minimize className="h-5 w-5" />
                  ) : (
                    <Maximize className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <FileDetailsDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        streamInfo={streamInfo}
        title={title}
        mediaId={
          mediaId && !Number.isNaN(parseInt(mediaId, 10))
            ? parseInt(mediaId, 10)
            : null
        }
        playbackQuality={quality}
      />

      <SubtitleSearchDialog
        open={subtitleSearchOpen}
        onClose={() => setSubtitleSearchOpen(false)}
        fileId={fileId}
        type={type === "movie" ? "movie" : "episode"}
        opensubtitlesConfigured={opensubtitlesConfigured}
        onDownloaded={(track) => {
          setSubtitles((current) => {
            const exists = current.some((entry) => entry.id === track.id);
            return exists ? current : [...current, track];
          });
          setActiveSubtitle(track.id);
          setSubtitleMenuOpen(false);
          void refreshSubtitles(track);
        }}
      />
    </div>
  );
}
