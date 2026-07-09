import type Hls from "hls.js";
import {
  createPlaybackHls,
  getVideoBufferedEnd,
  startDirectPlaybackWithResume,
} from "@/lib/playback-utils";

let hlsModulePromise: Promise<typeof import("hls.js").default> | null = null;

export async function loadHls() {
  if (!hlsModulePromise) {
    hlsModulePromise = import("hls.js").then((mod) => mod.default);
  }
  return hlsModulePromise;
}

export interface WebPlaybackOptions {
  HlsConstructor?: typeof import("hls.js").default;
  video: HTMLVideoElement;
  url: string;
  usingHls: boolean;
  startAt: number;
  tv?: boolean;
  onFatalError: () => void;
  onBufferUpdate: () => void;
  onSeekComplete?: (seconds: number) => void;
  onSourceReady?: () => void;
}

export interface WebPlaybackHandle {
  cleanup: () => void;
  hls: Hls | null;
}

export function destroyHlsInstance(hls: Hls | null): void {
  if (!hls) return;
  hls.stopLoad();
  hls.detachMedia();
  hls.destroy();
}

function resumeHlsLoading(hls: Hls, video: HTMLVideoElement): void {
  const position = Math.max(0, video.currentTime);
  try {
    hls.startLoad(position);
  } catch {
    try {
      hls.startLoad(-1);
    } catch {
      // ignore — next watchdog tick will retry
    }
  }
}

export function startWebPlayback(options: WebPlaybackOptions): WebPlaybackHandle {
  const {
    HlsConstructor,
    video,
    url,
    usingHls,
    startAt,
    tv,
    onFatalError,
    onBufferUpdate,
    onSeekComplete,
    onSourceReady,
  } = options;

  let hls: Hls | null = null;
  let stopDirectPlayback: (() => void) | null = null;
  let hlsRecoveryAttempts = 0;
  const maxHlsRecoveryAttempts = 4;
  let stallWatchdog: ReturnType<typeof setInterval> | null = null;
  let waitingRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPlaybackAdvanceMs = Date.now();
  let lastPlaybackPosition = 0;

  const clearStallTimers = () => {
    if (stallWatchdog) {
      clearInterval(stallWatchdog);
      stallWatchdog = null;
    }
    if (waitingRecoveryTimer) {
      clearTimeout(waitingRecoveryTimer);
      waitingRecoveryTimer = null;
    }
  };

  const onVideoError = () => {
    onFatalError();
  };

  const trackPlaybackAdvance = () => {
    if (video.currentTime > lastPlaybackPosition + 0.05) {
      lastPlaybackPosition = video.currentTime;
      lastPlaybackAdvanceMs = Date.now();
    }
  };

  const scheduleWaitingRecovery = () => {
    if (!hls || video.ended) return;
    if (waitingRecoveryTimer) clearTimeout(waitingRecoveryTimer);
    waitingRecoveryTimer = setTimeout(() => {
      waitingRecoveryTimer = null;
      if (video.ended || video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        return;
      }
      resumeHlsLoading(hls!, video);
    }, 400);
  };

  const onWaiting = () => {
    scheduleWaitingRecovery();
  };

  const onTimeUpdate = () => {
    trackPlaybackAdvance();
    onBufferUpdate();
  };

  if (usingHls) {
    if (!HlsConstructor) {
      onFatalError();
      return { hls: null, cleanup: () => {} };
    }
    if (HlsConstructor.isSupported()) {
      hls = createPlaybackHls(HlsConstructor, { tv });
      hls.loadSource(url);
      hls.attachMedia(video);
      video.addEventListener("error", onVideoError);
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("timeupdate", onTimeUpdate);

      hls.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
        hls?.startLoad(0);
        lastPlaybackPosition = 0;
        lastPlaybackAdvanceMs = Date.now();
        onSourceReady?.();
        video.play().catch(() => {});
      });

      hls.on(HlsConstructor.Events.LEVEL_UPDATED, () => {
        if (!hls || video.paused || video.ended) return;
        if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
        resumeHlsLoading(hls, video);
      });

      hls.on(HlsConstructor.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          if (
            hls &&
            (data.details === HlsConstructor.ErrorDetails.FRAG_LOAD_ERROR ||
              data.details === HlsConstructor.ErrorDetails.FRAG_LOAD_TIMEOUT ||
              data.details === HlsConstructor.ErrorDetails.LEVEL_LOAD_ERROR)
          ) {
            resumeHlsLoading(hls, video);
          }
          return;
        }

        if (hls && hlsRecoveryAttempts < maxHlsRecoveryAttempts) {
          hlsRecoveryAttempts += 1;
          if (data.type === HlsConstructor.ErrorTypes.NETWORK_ERROR) {
            resumeHlsLoading(hls, video);
            return;
          }
          if (data.type === HlsConstructor.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
        }

        onFatalError();
      });

      hls.on(HlsConstructor.Events.FRAG_BUFFERED, onBufferUpdate);
      hls.on(HlsConstructor.Events.BUFFER_APPENDED, onBufferUpdate);

      stallWatchdog = setInterval(() => {
        if (!hls || video.paused || video.ended) return;

        trackPlaybackAdvance();

        const bufferedEnd = getVideoBufferedEnd(video);
        const nearBufferEdge = video.currentTime >= bufferedEnd - 0.75;
        if (!nearBufferEdge) return;

        if (Date.now() - lastPlaybackAdvanceMs < 2500) return;
        if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;

        resumeHlsLoading(hls, video);
        lastPlaybackAdvanceMs = Date.now();
      }, 1500);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener("error", onVideoError);
      onSourceReady?.();
      video.play().catch(() => {});
    } else {
      onFatalError();
    }
  } else {
    video.src = url;
    video.addEventListener("error", onVideoError);
    onSourceReady?.();
    stopDirectPlayback = startDirectPlaybackWithResume(video, startAt, {
      onSeekComplete,
    });
  }

  return {
    hls,
    cleanup: () => {
      clearStallTimers();
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("timeupdate", onTimeUpdate);
      stopDirectPlayback?.();
      destroyHlsInstance(hls);
    },
  };
}
