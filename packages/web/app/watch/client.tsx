"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Hls from "hls.js";
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  Subtitles,
  Settings2,
} from "lucide-react";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { cn, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CastButton } from "@/components/cast-button";

interface SubtitleTrack {
  id: number;
  language: string;
  label?: string | null;
}

export function WatchClient() {
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") ?? "movie") as "movie" | "episode";
  const fileId = parseInt(searchParams.get("id") ?? "", 10);
  const mediaId = searchParams.get("media");

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [transcode, setTranscode] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [posterPath, setPosterPath] = useState<string | null>(null);

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
      }, 3000);
    }
  }, []);

  const saveProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration || !fileId) return;
    api.saveProgress({
      itemType: type === "movie" ? "movie" : "episode",
      itemId: fileId,
      positionMs: Math.floor(video.currentTime * 1000),
      durationMs: Math.floor(video.duration * 1000),
    }).catch(() => {});
  }, [fileId, type]);

  useEffect(() => {
    if (!fileId || Number.isNaN(fileId)) return;

    if (mediaId) {
      api.getMedia(parseInt(mediaId, 10)).then((data) => {
        setTitle((data as { title: string }).title);
        setPosterPath((data as { posterPath?: string | null }).posterPath ?? null);
        if (type === "movie") {
          setSubtitles(
            ((data as { subtitles?: SubtitleTrack[] }).subtitles ?? []) as SubtitleTrack[],
          );
        } else {
          const seasons = (data as { seasons?: Array<{ episodes: Array<{ id: number; subtitles?: SubtitleTrack[] }> }> }).seasons ?? [];
          for (const season of seasons) {
            const ep = season.episodes.find((e) => e.id === fileId);
            if (ep) {
              setSubtitles(ep.subtitles ?? []);
              break;
            }
          }
        }
      }).catch(console.error);
    }
  }, [mediaId, fileId, type]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !fileId || Number.isNaN(fileId)) return;

    setError(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const url = api.streamUrl(fileId, type === "movie" ? "movie" : "episode", transcode);

    if (transcode) {
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) setError("Playback failed. Try toggling transcode mode.");
        });
        hlsRef.current = hls;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.play().catch(() => {});
      } else {
        setError("HLS not supported in this browser");
      }
    } else {
      video.src = url;
      video.play().catch(() => {});
    }

    progressInterval.current = setInterval(saveProgress, 10000);

    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (progressInterval.current) clearInterval(progressInterval.current);
      saveProgress();
    };
  }, [fileId, type, transcode, saveProgress]);

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
    };
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration || 0);
    const onLoadedMetadata = () => setDuration(video.duration || 0);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [revealControls]);

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
    if (!video) return;

    const existingTracks = video.querySelectorAll("track");
    existingTracks.forEach((t) => t.remove());

    if (activeSubtitle !== null) {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.src = api.subtitleUrl(activeSubtitle);
      track.default = true;
      track.label = subtitles.find((s) => s.id === activeSubtitle)?.language ?? "Subtitles";
      video.appendChild(track);
      track.track.mode = "showing";
    }
  }, [activeSubtitle, subtitles]);

  const handleCast = useCallback(async () => {
    const video = videoRef.current;
    const prepared = await api.prepareCast({
      fileId,
      type: type === "movie" ? "movie" : "episode",
      subtitleId: activeSubtitle ?? undefined,
      title: title || undefined,
      posterPath,
      startTimeMs: video ? Math.floor(video.currentTime * 1000) : 0,
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
  }, [fileId, type, activeSubtitle, title, posterPath, subtitles]);

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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      togglePlay();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const seek = (value: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = (value / 100) * duration;
    revealControls(true);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

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
      className="fixed inset-0 z-40 bg-black"
      onMouseMove={() => revealControls(true)}
      onTouchStart={() => revealControls(true)}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        controls={false}
        playsInline
        onClick={togglePlay}
      />

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <p className="mb-4 text-red-400">{error}</p>
            <Button onClick={() => setTranscode(!transcode)}>
              Try {transcode ? "Direct Play" : "Transcode"}
            </Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col justify-between transition-opacity duration-300 pointer-events-none",
          showControls ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto bg-gradient-to-b from-black/90 via-black/40 to-transparent px-4 pb-8 pt-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" asChild>
              <Link href={mediaId ? routes.media(parseInt(mediaId, 10)) : "/"}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <h1 className="truncate text-lg font-medium text-white">{title}</h1>
          </div>
        </div>

        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-4 pt-10">
          <div className="mb-3 flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progress}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>

              <span className="min-w-[5.5rem] text-sm tabular-nums text-white/80">
                {formatDuration(currentTime * 1000)} / {formatDuration(duration * 1000)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {subtitles.length > 0 && (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/10"
                    onClick={() => setSubtitleMenuOpen((open) => !open)}
                  >
                    <Subtitles className="h-4 w-4" />
                  </Button>
                  {subtitleMenuOpen && (
                    <div className="absolute bottom-full right-0 mb-2 min-w-32 rounded-lg border border-border bg-card p-1 shadow-xl">
                      <button
                        className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-secondary"
                        onClick={() => {
                          setActiveSubtitle(null);
                          setSubtitleMenuOpen(false);
                        }}
                      >
                        Off
                      </button>
                      {subtitles.map((sub) => (
                        <button
                          key={sub.id}
                          className={cn(
                            "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-secondary",
                            activeSubtitle === sub.id && "bg-primary/10 text-primary",
                          )}
                          onClick={() => {
                            setActiveSubtitle(sub.id);
                            setSubtitleMenuOpen(false);
                          }}
                        >
                          {sub.language}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10"
                onClick={() => setTranscode(!transcode)}
              >
                <Settings2 className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {transcode ? "Transcode" : "Direct"}
                </span>
              </Button>

              <CastButton onCast={handleCast} className="text-white hover:bg-white/10" />

              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
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
  );
}
