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

/** Resume after a premature `ended` at a growing transcode playlist boundary. */
export function recoverHlsPlaybackAtPlaylistEnd(
  video: HTMLVideoElement,
  hls: Hls | null,
): void {
  const resumeAt = Math.max(0, video.currentTime - 0.25);
  if (hls) {
    try {
      if (hls.currentLevel >= 0) {
        hls.loadLevel = hls.currentLevel;
      }
    } catch {
      // ignore — startLoad below still nudges loading
    }
    hls.startLoad(resumeAt);
  }
  // Browsers keep ended=true until the playhead moves after a seek.
  video.pause();
  video.currentTime = resumeAt;
  void video.play().catch(() => {});
}

/** Nudge HLS loading after returning to a foreground tab or pausing near the buffer edge. */
export function catchUpHlsPlayback(
  video: HTMLVideoElement,
  hls: Hls | null,
): void {
  if (!hls) {
    return;
  }

  if (video.ended) {
    recoverHlsPlaybackAtPlaylistEnd(video, hls);
    return;
  }

  const bufferedAhead = getVideoBufferedEnd(video) - video.currentTime;
  if (bufferedAhead >= 45 && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return;
  }

  try {
    if (hls.currentLevel >= 0) {
      hls.loadLevel = hls.currentLevel;
    }
  } catch {
    // ignore
  }
  hls.startLoad(video.currentTime);
}

/** Reload the growing playlist so new segments are discovered. */
function refreshHlsPlaylist(hls: Hls): void {
  const level = hls.currentLevel;
  if (level < 0) return;
  try {
    hls.loadLevel = level;
  } catch {
    // ignore — next poll will retry
  }
}

function isNearBufferEdge(video: HTMLVideoElement): boolean {
  const bufferedEnd = getVideoBufferedEnd(video);
  if (bufferedEnd <= 0) return false;
  return video.currentTime >= bufferedEnd - 1.25;
}

function needsMoreMediaData(video: HTMLVideoElement): boolean {
  return (
    !video.ended &&
    !video.paused &&
    video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
  );
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
  let manifestPollTimer: ReturnType<typeof setInterval> | null = null;
  let stallWatchdog: ReturnType<typeof setInterval> | null = null;
  let waitingRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPlaybackAdvanceMs = Date.now();
  let lastPlaybackPosition = 0;

  const clearTimers = () => {
    if (manifestPollTimer) {
      clearInterval(manifestPollTimer);
      manifestPollTimer = null;
    }
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

  const shouldRefreshGrowingPlaylist = () => {
    if (!hls || video.ended) return false;
    const playlistDuration = video.duration;
    const atSourceEnd =
      Number.isFinite(playlistDuration) &&
      playlistDuration > 0 &&
      video.currentTime >= playlistDuration - 0.5;
    if (atSourceEnd) return false;
    const bufferedAhead = getVideoBufferedEnd(video) - video.currentTime;
    const waitingForData =
      !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    return waitingForData || isNearBufferEdge(video) || bufferedAhead < 45;
  };

  const maybeRefreshPlaylist = () => {
    if (!shouldRefreshGrowingPlaylist()) return;
    refreshHlsPlaylist(hls!);
  };

  const scheduleWaitingRecovery = () => {
    if (!hls || video.ended) return;
    if (waitingRecoveryTimer) clearTimeout(waitingRecoveryTimer);
    waitingRecoveryTimer = setTimeout(() => {
      waitingRecoveryTimer = null;
      if (!needsMoreMediaData(video)) return;
      maybeRefreshPlaylist();
    }, 300);
  };

  const onWaiting = () => {
    scheduleWaitingRecovery();
  };

  const onTimeUpdate = () => {
    trackPlaybackAdvance();
    onBufferUpdate();
  };

  const startManifestPolling = () => {
    if (manifestPollTimer) return;
    manifestPollTimer = setInterval(() => {
      if (!hls || video.ended) return;
      const pausedNearEdge = video.paused && isNearBufferEdge(video);
      if (video.paused && !pausedNearEdge) return;
      maybeRefreshPlaylist();
    }, 3000);
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
        startManifestPolling();
        onSourceReady?.();
        video.play().catch(() => {});
      });

      hls.on(HlsConstructor.Events.LEVEL_UPDATED, () => {
        onBufferUpdate();
      });

      hls.on(HlsConstructor.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          if (
            hls &&
            (data.details === HlsConstructor.ErrorDetails.FRAG_LOAD_ERROR ||
              data.details === HlsConstructor.ErrorDetails.FRAG_LOAD_TIMEOUT ||
              data.details === HlsConstructor.ErrorDetails.LEVEL_LOAD_ERROR ||
              data.details === HlsConstructor.ErrorDetails.LEVEL_PARSING_ERROR)
          ) {
            maybeRefreshPlaylist();
          }
          return;
        }

        if (hls && hlsRecoveryAttempts < maxHlsRecoveryAttempts) {
          hlsRecoveryAttempts += 1;
          if (data.type === HlsConstructor.ErrorTypes.NETWORK_ERROR) {
            maybeRefreshPlaylist();
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

        if (!isNearBufferEdge(video)) return;
        if (Date.now() - lastPlaybackAdvanceMs < 2000) return;
        if (!needsMoreMediaData(video)) return;

        maybeRefreshPlaylist();
        hls.startLoad(video.currentTime);
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
      clearTimers();
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("timeupdate", onTimeUpdate);
      stopDirectPlayback?.();
      destroyHlsInstance(hls);
    },
  };
}
