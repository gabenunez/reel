"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { ensureAudioUnlocked, getSharedAudioContext } from "@/lib/audio-unlock";
import { useThemeMusicSettings } from "@/components/theme-music-settings";
import { isTvClient } from "@/lib/tv-mode-detect";

const TARGET_VOLUME = 0.38;
const FADE_MS = 1800;
const MAX_PLAY_MS = 42_000;

const themeBlobCache = new Map<number, Blob>();

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

async function loadThemeBlob(mediaId: number, signal: AbortSignal): Promise<Blob> {
  const cached = themeBlobCache.get(mediaId);
  if (cached) return cached;

  const res = await fetch(api.themeMusicUrl(mediaId), {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error("Theme unavailable");

  const blob = await res.blob();
  themeBlobCache.set(mediaId, blob);
  return blob;
}

function tryAttachAnalyser(element: HTMLAudioElement): AnalyserNode | null {
  try {
    const audioContext = getSharedAudioContext();
    const source = audioContext.createMediaElementSource(element);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    return analyser;
  } catch {
    return null;
  }
}

type ThemeMusicContextValue = {
  isPlaying: boolean;
  analyser: AnalyserNode | null;
};

const ThemeMusicContext = createContext<ThemeMusicContextValue>({
  isPlaying: false,
  analyser: null,
});

export function useThemeMusic() {
  return useContext(ThemeMusicContext);
}

interface ThemeMusicProviderProps {
  mediaId: number;
  enabled?: boolean;
  children: ReactNode;
}

export function ThemeMusicProvider({
  mediaId,
  enabled = true,
  children,
}: ThemeMusicProviderProps) {
  const { enabled: themeMusicEnabled } = useThemeMusicSettings();
  const playThemeMusic = isTvClient() || themeMusicEnabled;
  const [isPlaying, setIsPlaying] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const stopFadeRef = useRef<(() => void) | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!playThemeMusic) {
      cleanupRef.current?.();
    }
  }, [playThemeMusic]);

  useEffect(() => {
    if (!enabled || !mediaId || !playThemeMusic) return;

    const session = Symbol("theme-session");
    let activeSession: symbol | null = session;
    let objectUrl: string | null = null;
    let audio: HTMLAudioElement | null = null;
    let readyHandler: (() => void) | null = null;
    let playbackStarted = false;
    let playbackQueued = false;
    let retryListenersAttached = false;
    const abortController = new AbortController();

    const isActive = () => activeSession === session;

    const cleanup = () => {
      activeSession = null;
      setIsPlaying(false);
      setAnalyser(null);
      stopFadeRef.current?.();
      stopFadeRef.current = null;
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      if (audio) {
        if (readyHandler) {
          audio.removeEventListener("loadeddata", readyHandler);
          audio.removeEventListener("canplay", readyHandler);
          audio.removeEventListener("canplaythrough", readyHandler);
          readyHandler = null;
        }
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      abortController.abort();
    };

    cleanupRef.current = cleanup;

    const removeRetryListeners = (handler: () => void) => {
      document.removeEventListener("pointerdown", handler, true);
      document.removeEventListener("keydown", handler, true);
      retryListenersAttached = false;
    };

    const scheduleStop = () => {
      if (!audio) return;
      const playForMs = Math.min(
        MAX_PLAY_MS,
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration * 1000
          : MAX_PLAY_MS,
      );

      stopTimerRef.current = setTimeout(() => {
        if (!isActive() || !audio) return;
        stopFadeRef.current = fadeVolume(audio, audio.volume, 0, FADE_MS, () => {
          cleanup();
        });
      }, playForMs);
    };

    const beginAudiblePlayback = () => {
      if (!audio || !isActive()) return;

      audio.muted = false;
      setIsPlaying(true);
      stopFadeRef.current = fadeVolume(audio, 0, TARGET_VOLUME, FADE_MS);
      scheduleStop();

      window.setTimeout(() => {
        if (!isActive() || !audio || !audio.paused) return;
        void audio.play().catch(() => {});
      }, 400);
    };

    const attemptPlay = async () => {
      if (!isActive() || !audio || playbackStarted) return;
      playbackStarted = true;

      audio.muted = true;
      audio.volume = 0;

      await ensureAudioUnlocked();

      const node = tryAttachAnalyser(audio);
      if (node) {
        setAnalyser(node);
        await getSharedAudioContext().resume();
      }

      try {
        await audio.play();
      } catch {
        playbackStarted = false;
        throw new Error("play blocked");
      }

      if (!isActive() || !audio) return;
      beginAudiblePlayback();
    };

    const queueGestureRetry = () => {
      if (!isActive() || retryListenersAttached) return;
      retryListenersAttached = true;

      const retry = () => {
        removeRetryListeners(retry);
        if (!isActive() || !audio) return;
        void attemptPlay().catch(() => {
          playbackStarted = false;
        });
      };

      document.addEventListener("pointerdown", retry, { once: true, capture: true });
      document.addEventListener("keydown", retry, { once: true, capture: true });
    };

    const queuePlayback = () => {
      if (!isActive() || !audio || playbackStarted || playbackQueued) return;
      playbackQueued = true;
      void attemptPlay().catch(() => {
        playbackStarted = false;
        playbackQueued = false;
        queueGestureRetry();
      });
    };

    void loadThemeBlob(mediaId, abortController.signal)
      .then((blob) => {
        if (!isActive()) return;

        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
        audio.preload = "auto";
        audio.volume = 0;

        let readyHandled = false;
        readyHandler = () => {
          if (readyHandled) return;
          readyHandled = true;
          queuePlayback();
        };
        audio.addEventListener("loadeddata", readyHandler);
        audio.addEventListener("canplay", readyHandler);
        audio.addEventListener("canplaythrough", readyHandler);
        audio.addEventListener("ended", () => {
          if (isActive()) cleanup();
        });
        audio.addEventListener("error", () => {
          if (isActive()) cleanup();
        }, { once: true });

        audio.load();

        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          queuePlayback();
        }
      })
      .catch(() => {
        if (isActive()) cleanup();
      });

    return () => {
      cleanup();
      cleanupRef.current = null;
    };
  }, [mediaId, enabled, playThemeMusic]);

  return (
    <ThemeMusicContext.Provider value={{ isPlaying, analyser }}>
      {children}
    </ThemeMusicContext.Provider>
  );
}

/** Transparent live waveform for the media detail banner. */
export function ThemeMusicWaveform({ className = "" }: { className?: string }) {
  const { isPlaying, analyser } = useThemeMusic();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const analyserRef = useRef(analyser);

  useEffect(() => {
    analyserRef.current = analyser;
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isPlaying) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buffer = new Uint8Array(64);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const node = analyserRef.current;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      ctx.clearRect(0, 0, width, height);

      if (width < 8 || height < 8) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }

      if (node) {
        node.getByteFrequencyData(buffer.subarray(0, node.frequencyBinCount));
      }

      const barCount = 56;
      const gap = 2;
      const barWidth = (width - gap * (barCount - 1)) / barCount;
      if (barWidth < 1) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }

      const midY = height * 0.62;
      const radius = Math.min(barWidth / 2, height * 0.21);

      for (let i = 0; i < barCount; i++) {
        const sample =
          node && buffer.length > 0
            ? buffer[Math.floor((i / barCount) * buffer.length)] / 255
            : 0.12 + Math.sin(performance.now() / 280 + i * 0.35) * 0.06;

        const amplitude = Math.max(0.06, sample);
        const barHeight = amplitude * height * 0.42;
        const x = i * (barWidth + gap);
        const alpha = 0.12 + amplitude * 0.38;

        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, midY - barHeight, barWidth, barHeight * 2, radius);
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frameRef.current);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    };
  }, [isPlaying]);

  if (!isPlaying) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none ${className}`}
    />
  );
}

/** @deprecated Use ThemeMusicProvider + ThemeMusicWaveform */
export function ThemeMusicPlayer({
  mediaId,
  enabled = true,
}: {
  mediaId: number;
  enabled?: boolean;
}) {
  return (
    <ThemeMusicProvider mediaId={mediaId} enabled={enabled}>
      {null}
    </ThemeMusicProvider>
  );
}
