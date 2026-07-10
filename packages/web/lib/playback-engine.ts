import type Hls from "hls.js";
import {
  createPlaybackHls,
  getContiguousBufferedAhead,
  playlistM3u8HasEndList,
  RECOVERY_FORGIVE_PROGRESS_SECONDS,
  resolveRecoveryBudget,
  resolveStallWatchdogAction,
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

/**
 * Resume after a premature `ended` at a growing-transcode boundary.
 *
 * Never seeks: any automatic currentTime change can skip or rewind and the
 * viewer loses their place. hls.js keeps reloading the live playlist; we only
 * re-issue play() and let the buffer gate hold until the next segment lands.
 * Do NOT call startLoad() — that resets the fragment loader.
 */
export function recoverHlsPlaybackAtPlaylistEnd(
  video: HTMLVideoElement,
  _hls: Hls | null,
): void {
  void video.play().catch(() => {});
}

/**
 * Nudge playback after returning to a foreground tab. hls.js keeps buffering
 * on its own; we only need to resume the element if it was paused/stalled by
 * the browser while backgrounded, or clear a premature `ended`.
 */
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

  if (video.paused) {
    void video.play().catch(() => {});
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
  let hlsRecoveryBudgetSpent = 0;
  let positionAtLastRecovery = 0;
  const maxHlsRecoveryAttempts = 4;
  let didAttemptPipelineReset = false;
  let stallWatchdog: ReturnType<typeof setInterval> | null = null;
  let lastPlaybackAdvanceMs = Date.now();
  let lastPlaybackPosition = 0;
  let consecutiveStallNudges = 0;
  let waitGrowTicks = 0;
  let playlistHasEndList = false;
  let userWantsPlay = true;

  const onManifestSawEndList = (m3u8: string) => {
    if (!playlistHasEndList && playlistM3u8HasEndList(m3u8)) {
      playlistHasEndList = true;
    }
  };

  const clearTimers = () => {
    if (stallWatchdog) {
      clearInterval(stallWatchdog);
      stallWatchdog = null;
    }
  };

  const onVideoError = () => {
    onFatalError();
  };

  const trackPlaybackAdvance = () => {
    if (video.currentTime > lastPlaybackPosition + 0.05) {
      lastPlaybackPosition = video.currentTime;
      lastPlaybackAdvanceMs = Date.now();
      consecutiveStallNudges = 0;
      waitGrowTicks = 0;
      if (
        didAttemptPipelineReset &&
        video.currentTime - positionAtLastRecovery >=
          RECOVERY_FORGIVE_PROGRESS_SECONDS
      ) {
        didAttemptPipelineReset = false;
      }
    }
  };

  // Soft media recovery only — never seeks the playhead. A detach/reattach
  // with startLoad(currentTime - epsilon) used to skip/rewind; forbidden.
  const attemptSoftMediaRecovery = (): boolean => {
    if (!hls) return false;
    didAttemptPipelineReset = true;
    positionAtLastRecovery = video.currentTime;
    try {
      hls.recoverMediaError();
      void video.play().catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  const onTimeUpdate = () => {
    trackPlaybackAdvance();
    onBufferUpdate();
  };

  const onUserPlay = () => {
    userWantsPlay = true;
  };

  const onUserPause = () => {
    userWantsPlay = false;
  };

  if (usingHls) {
    if (!HlsConstructor) {
      onFatalError();
      return { hls: null, cleanup: () => {} };
    }
    if (HlsConstructor.isSupported()) {
      hls = createPlaybackHls(HlsConstructor, { tv });
      hls.attachMedia(video);
      hls.loadSource(url);
      video.addEventListener("error", onVideoError);
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("play", onUserPlay);
      video.addEventListener("pause", onUserPause);

      hls.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
        // Load from relative 0 (server already applied -ss). Let hls.js own
        // buffer growth; a client-side pause gate can become an infinite hold
        // when an encoder is producing segments near real time.
        hls?.startLoad(0);
        lastPlaybackPosition = video.currentTime;
        lastPlaybackAdvanceMs = Date.now();
        onSourceReady?.();
        video.play().catch(() => {});
      });

      const resumeAfterFragment = () => {
        onBufferUpdate();
        // A growing playlist can briefly exhaust the current buffer. Once the
        // next fragment lands, resume only if the viewer had been playing.
        if (userWantsPlay && video.paused && !video.ended) {
          video.play().catch(() => {});
        }
      };

      hls.on(HlsConstructor.Events.FRAG_PARSED, resumeAfterFragment);
      hls.on(HlsConstructor.Events.FRAG_BUFFERED, resumeAfterFragment);
      hls.on(HlsConstructor.Events.BUFFER_APPENDED, () => {
        onBufferUpdate();
      });

      hls.on(HlsConstructor.Events.LEVEL_UPDATED, (_, data) => {
        onManifestSawEndList(data.details.m3u8);
        onBufferUpdate();
      });

      hls.on(HlsConstructor.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          return;
        }

        if (hls) {
          const isRecoverableType =
            data.type === HlsConstructor.ErrorTypes.NETWORK_ERROR ||
            data.type === HlsConstructor.ErrorTypes.MEDIA_ERROR;

          if (isRecoverableType) {
            const { allowed, nextSpentBudget } = resolveRecoveryBudget({
              spentBudget: hlsRecoveryBudgetSpent,
              maxBudget: maxHlsRecoveryAttempts,
              currentPositionSeconds: video.currentTime,
              positionAtLastRecoverySeconds: positionAtLastRecovery,
            });

            if (allowed) {
              hlsRecoveryBudgetSpent = nextSpentBudget;
              positionAtLastRecovery = video.currentTime;

              // Always resume from the current playhead — bare startLoad() can
              // snap to the live edge and skip the viewer ahead.
              if (data.type === HlsConstructor.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad(Math.max(0, video.currentTime));
                return;
              }
              hls.recoverMediaError();
              return;
            }
          }

          if (!didAttemptPipelineReset && attemptSoftMediaRecovery()) {
            return;
          }
        }

        onFatalError();
      });

      // Never seeks. Buffer underruns are handled by the media element/hls.js;
      // the watchdog only records a genuine wedge and performs soft recovery.
      stallWatchdog = setInterval(() => {
        if (!hls) return;
        if (video.paused && !video.ended) return;
        if (video.seeking) return;
        if (video.ended) {
          if (!playlistHasEndList) {
            recoverHlsPlaybackAtPlaylistEnd(video, hls);
          }
          return;
        }

        trackPlaybackAdvance();

        const bufferAheadSeconds = getContiguousBufferedAhead(video);
        const stuckWithData =
          video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
          bufferAheadSeconds >= 0.25;

        const decision = resolveStallWatchdogAction({
          msSinceAdvance: Date.now() - lastPlaybackAdvanceMs,
          bufferAheadSeconds,
          stuckWithData,
          playlistHasEndList,
          consecutiveStallNudges,
          waitGrowTicks,
          didAttemptPipelineReset,
        });

        consecutiveStallNudges = decision.nextStallNudges;
        waitGrowTicks = decision.nextWaitGrowTicks;

        if (decision.action === "none") return;

        if (decision.action === "wait-grow" || decision.action === "nudge") {
          lastPlaybackAdvanceMs = Date.now();
          return;
        }

        if (decision.action === "pipeline-reset") {
          if (!didAttemptPipelineReset) {
            attemptSoftMediaRecovery();
          }
          lastPlaybackAdvanceMs = Date.now();
          return;
        }

        if (decision.action === "fatal") {
          onFatalError();
          lastPlaybackAdvanceMs = Date.now();
        }
      }, 2000);
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
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onUserPlay);
      video.removeEventListener("pause", onUserPause);
      stopDirectPlayback?.();
      destroyHlsInstance(hls);
    },
  };
}
