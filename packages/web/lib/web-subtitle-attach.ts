import { shiftVttByOffset } from "@media-app/shared";
import { api } from "@/lib/api";

const vttCache = new Map<number, string>();
const inflight = new Map<number, Promise<string | null>>();
const playbackReadyListeners = new Set<() => void>();

export function notifyWebPlaybackSourceReady(): void {
  for (const listener of playbackReadyListeners) {
    listener();
  }
}

export function subscribeWebPlaybackSourceReady(listener: () => void): () => void {
  playbackReadyListeners.add(listener);
  return () => {
    playbackReadyListeners.delete(listener);
  };
}

export function clearSubtitleVttCache(): void {
  vttCache.clear();
  inflight.clear();
}

export function evictSubtitleVttCache(subtitleId: number): void {
  vttCache.delete(subtitleId);
  inflight.delete(subtitleId);
}

export async function prefetchSubtitleVtt(
  subtitleId: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const cached = vttCache.get(subtitleId);
  if (cached) return cached;

  const pending = inflight.get(subtitleId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(api.subtitleUrl(subtitleId), {
        credentials: "include",
        signal,
      });
      if (!res.ok) return null;

      const vtt = await res.text();
      if (!vtt.trim()) return null;

      vttCache.set(subtitleId, vtt);
      return vtt;
    } catch {
      return null;
    } finally {
      inflight.delete(subtitleId);
    }
  })();

  inflight.set(subtitleId, promise);
  return promise;
}

export function prefetchSubtitleTracks(
  trackIds: number[],
  signal?: AbortSignal,
): void {
  for (const id of trackIds) {
    void prefetchSubtitleVtt(id, signal);
  }
}

function resolveShiftedVtt(subtitleId: number, timelineOffsetSeconds: number): string | null {
  const raw = vttCache.get(subtitleId);
  if (!raw) return null;
  return timelineOffsetSeconds > 0 ? shiftVttByOffset(raw, timelineOffsetSeconds) : raw;
}

function clearWebSubtitleTracks(video: HTMLVideoElement) {
  video.querySelectorAll("track").forEach((element) => element.remove());
  for (const track of Array.from(video.textTracks)) {
    track.mode = "disabled";
  }
}

function showTextTrack(video: HTMLVideoElement, textTrack: TextTrack) {
  for (const track of Array.from(video.textTracks)) {
    track.mode = track === textTrack ? "showing" : "disabled";
  }
}

function enableLatestSubtitleTrack(video: HTMLVideoElement) {
  const tracks = Array.from(video.textTracks).filter((track) => track.kind === "subtitles");
  const next = tracks.at(-1);
  if (next) showTextTrack(video, next);
}

function attachTrackElement(
  video: HTMLVideoElement,
  objectUrl: string,
  label: string,
): HTMLTrackElement {
  const trackElement = document.createElement("track");
  trackElement.kind = "subtitles";
  trackElement.src = objectUrl;
  trackElement.default = true;
  trackElement.label = label;
  trackElement.srclang = label.slice(0, 2) || "en";
  trackElement.addEventListener("load", () => {
    if (trackElement.track) showTextTrack(video, trackElement.track);
  });
  video.appendChild(trackElement);
  if (trackElement.track) {
    showTextTrack(video, trackElement.track);
  } else {
    enableLatestSubtitleTrack(video);
  }
  return trackElement;
}

function attachVttToVideo(
  video: HTMLVideoElement,
  vtt: string,
  label: string,
): string {
  const objectUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
  attachTrackElement(video, objectUrl, label);
  requestAnimationFrame(() => enableLatestSubtitleTrack(video));
  return objectUrl;
}

export function attachCachedWebSubtitle(
  video: HTMLVideoElement,
  subtitleId: number,
  label: string,
  timelineOffsetSeconds = 0,
): string | null {
  const shifted = resolveShiftedVtt(subtitleId, timelineOffsetSeconds);
  if (!shifted) return null;

  clearWebSubtitleTracks(video);
  return attachVttToVideo(video, shifted, label);
}

export async function syncWebSubtitleTrack(
  video: HTMLVideoElement,
  subtitleId: number | null,
  label: string,
  signal: AbortSignal,
  timelineOffsetSeconds = 0,
): Promise<string | null> {
  clearWebSubtitleTracks(video);
  if (subtitleId === null || signal.aborted) return null;

  let shifted = resolveShiftedVtt(subtitleId, timelineOffsetSeconds);
  if (!shifted) {
    const raw = await prefetchSubtitleVtt(subtitleId, signal);
    if (!raw || signal.aborted) return null;
    shifted =
      timelineOffsetSeconds > 0 ? shiftVttByOffset(raw, timelineOffsetSeconds) : raw;
  }

  if (!shifted || signal.aborted) return null;
  return attachVttToVideo(video, shifted, label);
}

export function installWebSubtitleVideoListeners(
  video: HTMLVideoElement,
  onReload: () => void,
): () => void {
  const onAddTrack = (event: TrackEvent) => {
    if (event.track?.kind === "subtitles") {
      showTextTrack(video, event.track);
    }
  };

  video.textTracks.addEventListener("addtrack", onAddTrack);
  video.addEventListener("loadeddata", onReload);
  video.addEventListener("loadedmetadata", onReload);
  video.addEventListener("canplay", onReload);
  video.addEventListener("seeked", onReload);
  video.addEventListener("emptied", onReload);

  return () => {
    video.textTracks.removeEventListener("addtrack", onAddTrack);
    video.removeEventListener("loadeddata", onReload);
    video.removeEventListener("loadedmetadata", onReload);
    video.removeEventListener("canplay", onReload);
    video.removeEventListener("seeked", onReload);
    video.removeEventListener("emptied", onReload);
  };
}

export function clearWebSubtitleTracksFromVideo(video: HTMLVideoElement) {
  clearWebSubtitleTracks(video);
}
