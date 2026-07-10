import type Hls from "hls.js";
import {
  createPlaybackHls,
  playlistM3u8HasEndList,
  RECOVERY_FORGIVE_PROGRESS_SECONDS,
  resolveRecoveryBudget,
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
 * Resume after a premature `ended` fired at a growing-transcode boundary
 * (the playlist had no `#EXT-X-ENDLIST` yet, so this isn't the true file end).
 *
 * hls.js keeps its live-playlist reload timer running, so the next segment is
 * discovered automatically; here we only need to clear the element's `ended`
 * latch. A tiny backward seek moves the playhead so the browser drops
 * `ended`, then playback continues once hls.js appends the newly-available
 * segment. We deliberately do NOT call `hls.startLoad()` — that aborts and
 * resets hls.js's fragment loader, throwing away buffered-ahead data.
 */
export function recoverHlsPlaybackAtPlaylistEnd(
  video: HTMLVideoElement,
  _hls: Hls | null,
): void {
  const resumeAt = Math.max(0, video.currentTime - 0.05);
  video.currentTime = resumeAt;
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
  // Unforgiven fatal-recovery attempts. Unlike a monotonic counter, this is
  // credited back once the stream demonstrates sustained healthy playback
  // (see resolveRecoveryBudget), so a multi-hour session isn't permanently
  // disarmed by a handful of transient, fully-recovered blips.
  let hlsRecoveryBudgetSpent = 0;
  let positionAtLastRecovery = 0;
  const maxHlsRecoveryAttempts = 4;
  // Last-ditch media pipeline reset (detach + reattach + reload) tried once
  // before surfacing a fatal error to the UI.
  let didAttemptPipelineReset = false;
  let stallWatchdog: ReturnType<typeof setInterval> | null = null;
  let lastPlaybackAdvanceMs = Date.now();
  let lastPlaybackPosition = 0;
  // Number of consecutive stall-watchdog nudges that didn't unstick the
  // playhead. Escalates: small nudge → pipeline reset → fatal (quality
  // fallback), so playback never hangs forever.
  let consecutiveStallNudges = 0;
  const maxStallNudgesBeforeReset = 3;
  const maxStallNudgesBeforeFatal = 6;
  // Whether `#EXT-X-ENDLIST` has appeared in the loaded manifest. Once true,
  // this must never be reverted to false — LevelUpdated callbacks can still
  // fire with an older/stale manifest string during hls.js reload races.
  let playlistHasEndList = false;
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
      // A pipeline reset that led to sustained healthy playback is re-armed
      // so a later, unrelated wedge can be recovered the same way instead of
      // going straight to fatal.
      if (
        didAttemptPipelineReset &&
        video.currentTime - positionAtLastRecovery >=
          RECOVERY_FORGIVE_PROGRESS_SECONDS
      ) {
        didAttemptPipelineReset = false;
      }
    }
  };

  // Full media-pipeline reset: detach + reattach + reload from the current
  // position. Clears a wedged SourceBuffer that recoverMediaError can't.
  // Returns false if the reset threw.
  const attemptPipelineReset = (): boolean => {
    if (!hls) return false;
    didAttemptPipelineReset = true;
    positionAtLastRecovery = video.currentTime;
    const resumeAt = Math.max(0, video.currentTime - 0.25);
    try {
      hls.detachMedia();
      hls.attachMedia(video);
      hls.startLoad(resumeAt);
      return true;
    } catch {
      return false;
    }
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
      hls.attachMedia(video);
      hls.loadSource(url);
      video.addEventListener("error", onVideoError);
      video.addEventListener("timeupdate", onTimeUpdate);

      hls.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
        // Kick off loading from the start of the HLS timeline. The HLS session
        // is created with the server-side `-ss startAt` seek, so the playlist
        // itself begins at 0 == absolute `startAt`; we must load from relative
        // position 0, not `startAt`.
        //
        // hls.js then buffers ahead up to maxBufferLength on its own and, for
        // a growing (live, no-ENDLIST) playlist, reloads the manifest on its
        // native timer to discover new segments. We must NOT poll startLoad()
        // ourselves — startLoad() aborts and resets the fragment loader, which
        // throws away buffered-ahead data and prevents the buffer from ever
        // growing past one segment.
        hls?.startLoad(0);
        lastPlaybackPosition = video.currentTime;
        lastPlaybackAdvanceMs = Date.now();
        onSourceReady?.();
        video.play().catch(() => {});
      });

      hls.on(HlsConstructor.Events.FRAG_PARSED, () => {
        if (video.paused && !video.ended) {
          video.play().catch(() => {});
        }
      });

      hls.on(HlsConstructor.Events.LEVEL_UPDATED, (_, data) => {
        onManifestSawEndList(data.details.m3u8);
        onBufferUpdate();
      });

      hls.on(HlsConstructor.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          // Non-fatal errors (transient frag/level load failures on a growing
          // transcode where a segment isn't written yet) are retried by
          // hls.js internally per its *LoadingMaxRetry config, and the live
          // playlist reload picks up new segments. Nothing to do here — do
          // NOT call startLoad(), which would reset the loader and drop the
          // buffer.
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

              if (data.type === HlsConstructor.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
                return;
              }
              // MEDIA_ERROR
              hls.recoverMediaError();
              return;
            }
          }

          // Budget exhausted, or a non-recoverable type (OTHER/MUX): one full
          // media-pipeline reset before surfacing a fatal error.
          if (!didAttemptPipelineReset && attemptPipelineReset()) {
            return;
          }
        }

        onFatalError();
      });

      hls.on(HlsConstructor.Events.FRAG_BUFFERED, onBufferUpdate);
      hls.on(HlsConstructor.Events.BUFFER_APPENDED, onBufferUpdate);

      // Safety-net watchdog for a genuinely wedged playhead. hls.js handles
      // normal buffering/reloading and most gap-nudging (nudgeOnVideoHole);
      // this only fires when playback has not advanced for a sustained period
      // while it should be playing. It never "refreshes" via startLoad (that
      // resets the loader). It escalates: micro-nudge → pipeline reset →
      // fatal (quality fallback), so playback can never hang forever.
      stallWatchdog = setInterval(() => {
        if (!hls) return;
        if (video.paused) return;
        if (video.seeking) return;
        // A premature `ended` at a growing edge: clear the ended latch so
        // hls.js's already-running loader/reload can continue.
        if (video.ended) {
          if (!playlistHasEndList) {
            recoverHlsPlaybackAtPlaylistEnd(video, hls);
          }
          return;
        }

        trackPlaybackAdvance();

        // Playing normally — nothing to do.
        if (Date.now() - lastPlaybackAdvanceMs < 4000) return;
        // The player has buffered data ahead but simply isn't advancing (e.g.
        // decoder hiccup) — a tiny nudge unsticks it.
        const stuckWithData =
          video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;

        consecutiveStallNudges += 1;

        if (consecutiveStallNudges >= maxStallNudgesBeforeFatal) {
          consecutiveStallNudges = 0;
          onFatalError();
          lastPlaybackAdvanceMs = Date.now();
          return;
        }

        if (consecutiveStallNudges >= maxStallNudgesBeforeReset) {
          if (!didAttemptPipelineReset) {
            attemptPipelineReset();
          } else {
            onFatalError();
          }
          lastPlaybackAdvanceMs = Date.now();
          return;
        }

        // Micro-nudge: skip past a tiny buffer hole / kick the decoder.
        if (stuckWithData) {
          video.currentTime = video.currentTime + 0.1;
        }
        void video.play().catch(() => {});
        lastPlaybackAdvanceMs = Date.now();
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
      stopDirectPlayback?.();
      destroyHlsInstance(hls);
    },
  };
}
