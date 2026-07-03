"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Hls from "hls.js";
import { ChevronLeft, Loader2, Pause, Play } from "lucide-react";
import { api, type StreamInfo, type StreamQuality } from "@/lib/api";
import { tvRoutes } from "@/lib/tv/routes";
import {
  buildPlaybackTitle,
  getVideoSeekableEnd,
  PROGRESS_SAVE_MS,
  resolvePlaybackStream,
  startDirectPlaybackWithResume,
  type PlaybackMediaDetail,
} from "@/lib/playback-utils";
import { TvFocusLink } from "@/components/tv/tv-focus-link";
import { cn, formatDuration } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/use-document-title";

export function TvWatchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") ?? "movie") as "movie" | "episode";
  const fileId = parseInt(searchParams.get("id") ?? "", 10);
  const mediaId = searchParams.get("media");

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsStartOffsetRef = useRef(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProgressRef = useRef<() => void>(() => {});
  const seekToAbsoluteRef = useRef<(seconds: number) => void>(() => {});

  const [quality, setQuality] = useState<StreamQuality>("original");
  const [hlsStartOffset, setHlsStartOffset] = useState(0);
  const [streamStartSeconds, setStreamStartSeconds] = useState<number | null>(null);
  const [sourceDurationMs, setSourceDurationMs] = useState(0);
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [initialResumeSeconds, setInitialResumeSeconds] = useState<number | null>(null);

  const playbackStream = useMemo(
    () => resolvePlaybackStream(quality, streamInfo),
    [quality, streamInfo],
  );
  const usingHlsPlayback = playbackStream.usingHls;

  const backHref =
    mediaId && !Number.isNaN(parseInt(mediaId, 10))
      ? tvRoutes.media(parseInt(mediaId, 10))
      : tvRoutes.home();

  useDocumentTitle(title || null);

  const revealControls = useCallback((autoHide = true) => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    const video = videoRef.current;
    if (autoHide && video && !video.paused) {
      hideControlsTimer.current = setTimeout(() => setShowControls(false), 4000);
    }
  }, []);

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
        setSourceDurationMs(info.durationMs ?? 0);
        setQuality("original");

        const playback = resolvePlaybackStream("original", info);
        if (!playback.usingHls && playback.audioCompatNotice) {
          setError(playback.audioCompatNotice);
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

    if (hlsRef.current) {
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
            setError("Playback failed. Try again from the detail page.");
          }
        });
        hlsRef.current = hls;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.play().catch(() => {});
      } else {
        setBuffering(false);
        setError("HLS not supported on this device");
      }
    } else {
      video.src = url;
      stopDirectPlayback = startDirectPlaybackWithResume(video, startAt, {
        onSeekComplete: (seconds) => setCurrentTime(seconds),
      });
    }

    progressInterval.current = setInterval(() => saveProgressRef.current(), PROGRESS_SAVE_MS);

    return () => {
      stopDirectPlayback?.();
      if (hlsRef.current) hlsRef.current.destroy();
      if (progressInterval.current) clearInterval(progressInterval.current);
      saveProgressRef.current();
    };
  }, [fileId, type, quality, streamGeneration, streamStartSeconds, initialResumeSeconds, streamInfo]);

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
  const progress =
    absoluteDurationMs > 0 ? (absoluteCurrentTime * 1000) / absoluteDurationMs * 100 : 0;

  const seekToAbsolute = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video || !totalDurationSeconds) return;

      const clamped = Math.max(0, Math.min(seconds, totalDurationSeconds));

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
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration || 0);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
    };
  }, [revealControls, saveProgress]);

  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

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

      if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack") {
        e.preventDefault();
        router.push(backHref);
        return;
      }

      if (e.code === "Space" || e.key === "MediaPlayPause") {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.key === "ArrowRight" || e.key === "MediaFastForward") {
        e.preventDefault();
        seekToAbsoluteRef.current(absoluteCurrentTime + 10);
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "MediaRewind") {
        e.preventDefault();
        seekToAbsoluteRef.current(Math.max(0, absoluteCurrentTime - 10));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, absoluteCurrentTime, router, backHref]);

  const isPreparing = initialResumeSeconds === null;
  const showLoadingOverlay = (isPreparing || buffering) && !error;

  if (!fileId || Number.isNaN(fileId)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="text-center">
          <p className="mb-4 text-muted-foreground">Invalid playback URL</p>
          <TvFocusLink href={tvRoutes.home()} className="inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">
            Go home
          </TvFocusLink>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black"
      onMouseMove={() => revealControls(true)}
      onClick={() => revealControls(true)}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        controls={false}
        playsInline
        preload="auto"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
      />

      {showLoadingOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-background/80 px-5 py-4 text-lg text-white">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            {isPreparing ? "Preparing..." : "Buffering..."}
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 px-8">
          <div className="max-w-lg text-center">
            <p className="mb-6 text-lg text-red-400">{error}</p>
            <TvFocusLink href={backHref} className="inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">
              Go back
            </TvFocusLink>
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col justify-between transition-opacity duration-300 pointer-events-none",
          showControls ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto bg-gradient-to-b from-black/85 to-transparent px-8 pb-10 pt-8">
          <div className="flex items-center gap-4">
            <TvFocusLink
              href={backHref}
              data-tv-item=""
              className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/10 backdrop-blur"
              aria-label="Back"
            >
              <ChevronLeft className="h-7 w-7 text-white" />
            </TvFocusLink>
            <div className="min-w-0">
              <p className="truncate text-2xl font-bold text-white">{title || "Playing"}</p>
              <p className="text-sm text-white/70">
                Space play/pause · ← → seek 10s · Back to exit
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/50 to-transparent px-8 pb-10 pt-16">
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-4 text-lg text-white">
            <button
              type="button"
              data-tv-item=""
              onClick={togglePlay}
              className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/10 outline-none focus-visible:ring-4 focus-visible:ring-primary"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-7 w-7" />
              ) : (
                <Play className="h-7 w-7 fill-current" />
              )}
            </button>
            <span className="font-mono tabular-nums">
              {formatDuration(absoluteCurrentTime * 1000)}
              {totalDurationSeconds > 0 && (
                <> / {formatDuration(totalDurationSeconds * 1000)}</>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
