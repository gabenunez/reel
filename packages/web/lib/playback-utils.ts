import type { StreamQuality } from "@/lib/api";
import type { StreamInfo } from "@/lib/api";
import {
  isBrowserDirectPlayVideoSupported,
  isHlsVideoCopySupported,
  normalizeCodecName,
  pickTranscodeQualityForPlayback,
  resolveOriginalPlaybackMode,
} from "@reel/shared";

export const PROGRESS_SAVE_MS = 10_000;

export type PlaybackHlsQuality = StreamQuality | "remux";

function browserSupportsHevcPlayback(): boolean {
  if (typeof document === "undefined") return false;
  const video = document.createElement("video");
  const codecs = [
    'video/mp4; codecs="hvc1.1.6.L120.90"',
    'video/mp4; codecs="hev1.1.6.L120.90"',
    'video/mp4; codecs="hvc1"',
  ];
  return codecs.some((codec) => video.canPlayType(codec) !== "");
}

function browserSupportsDirectPlayVideo(videoCodec?: string | null): boolean {
  if (!isBrowserDirectPlayVideoSupported(videoCodec)) return false;
  if (typeof document === "undefined") return true;

  const normalized = normalizeCodecName(videoCodec);
  if (normalized === "hevc" || normalized === "h265") {
    return browserSupportsHevcPlayback();
  }

  if (normalized === "h264" || normalized === "avc1") {
    const video = document.createElement("video");
    return video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== "";
  }

  return false;
}

function effectiveOriginalPlaybackMode(
  streamInfo: StreamInfo,
): ReturnType<typeof resolveOriginalPlaybackMode> {
  let mode = resolveOriginalPlaybackMode({
    audioCodec: streamInfo.audioCodec,
    videoCodec: streamInfo.videoCodec,
    transcodingEnabled: streamInfo.transcodingEnabled,
  });

  if (mode === "direct" && !browserSupportsDirectPlayVideo(streamInfo.videoCodec)) {
    if (!streamInfo.transcodingEnabled) return "unsupported";
    if (isHlsVideoCopySupported(streamInfo.videoCodec)) return "remux";
    return "transcode";
  }

  if (mode !== "remux") return mode;

  const videoCodec = normalizeCodecName(streamInfo.videoCodec);
  if (
    (videoCodec === "hevc" || videoCodec === "h265") &&
    !browserSupportsHevcPlayback()
  ) {
    return streamInfo.transcodingEnabled ? "transcode" : "unsupported";
  }

  return mode;
}

export function resolvePlaybackStream(
  quality: StreamQuality,
  streamInfo: StreamInfo | null,
): {
  usingHls: boolean;
  hlsQuality?: PlaybackHlsQuality;
  audioCompatNotice: string | null;
} {
  if (quality !== "original") {
    return { usingHls: true, hlsQuality: quality, audioCompatNotice: null };
  }

  const mode = streamInfo ? effectiveOriginalPlaybackMode(streamInfo) : "direct";

  if (mode === "direct" || !streamInfo) {
    return { usingHls: false, audioCompatNotice: null };
  }

  const codec = streamInfo.audioCodec?.toUpperCase() ?? "this format";
  const videoCodec = streamInfo.videoCodec?.toUpperCase() ?? "this format";
  const videoSupported = isBrowserDirectPlayVideoSupported(streamInfo.videoCodec);

  if (mode === "remux") {
    return {
      usingHls: true,
      hlsQuality: "remux",
      audioCompatNotice: null,
    };
  }

  if (mode === "transcode") {
    const fallback = pickTranscodeQualityForPlayback(streamInfo.availableQualities);
    return {
      usingHls: true,
      hlsQuality: fallback,
      audioCompatNotice: null,
    };
  }

  return {
    usingHls: false,
    audioCompatNotice: !videoSupported
      ? `${videoCodec} video can't play in the browser. Enable transcoding on the server or choose a lower quality.`
      : `${codec} audio can't play in the browser. Enable transcoding on the server or choose a lower quality.`,
  };
}

/** Pick the quality setting to use when opening the player for this file. */
export function resolveInitialStreamQuality(streamInfo: StreamInfo): {
  quality: StreamQuality;
  error: string | null;
} {
  const playback = resolvePlaybackStream("original", streamInfo);

  if (playback.usingHls) {
    if (playback.hlsQuality && playback.hlsQuality !== "remux") {
      return { quality: playback.hlsQuality, error: null };
    }
    return { quality: "original", error: null };
  }

  if (playback.audioCompatNotice) {
    if (streamInfo.transcodingEnabled) {
      return {
        quality: pickTranscodeQualityForPlayback(streamInfo.availableQualities),
        error: null,
      };
    }
    return { quality: "original", error: playback.audioCompatNotice };
  }

  return { quality: "original", error: null };
}

export interface TvEpisodeSummary {
  id: number;
  title?: string | null;
  episodeNumber: number;
  stillPath?: string | null;
}

export interface TvSeasonSummary {
  seasonNumber: number;
  episodes: TvEpisodeSummary[];
}

export interface PlaybackMediaDetail {
  title: string;
  posterPath?: string | null;
  seasons?: TvSeasonSummary[];
}

/** End of the seekable range containing the current playhead (or before it in a gap). */
/** Seek direct-play video to a resume point, then start playback (avoids a flash at 0:00). */
export function startDirectPlaybackWithResume(
  video: HTMLVideoElement,
  startSeconds: number,
  options?: { onSeekComplete?: (seconds: number) => void },
): () => void {
  let onLoadedData: (() => void) | null = null;
  let onSeeked: (() => void) | null = null;

  const cleanup = () => {
    if (onLoadedData) {
      video.removeEventListener("loadeddata", onLoadedData);
      onLoadedData = null;
    }
    if (onSeeked) {
      video.removeEventListener("seeked", onSeeked);
      onSeeked = null;
    }
  };

  const play = () => {
    void video.play().catch(() => {});
  };

  const seekAndPlay = () => {
    if (startSeconds <= 0 || !video.duration || !Number.isFinite(video.duration)) {
      play();
      return;
    }

    const target = Math.min(startSeconds, video.duration);
    options?.onSeekComplete?.(target);

    onSeeked = () => {
      cleanup();
      play();
    };

    video.addEventListener("seeked", onSeeked);
    video.currentTime = target;

    if (Math.abs(video.currentTime - target) < 0.25) {
      cleanup();
      play();
    }
  };

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    seekAndPlay();
  } else {
    onLoadedData = () => {
      cleanup();
      seekAndPlay();
    };
    video.addEventListener("loadeddata", onLoadedData);
  }

  return cleanup;
}

export function getVideoSeekableEnd(video: HTMLVideoElement): number {
  const ranges = video.seekable;
  if (!ranges.length) return 0;

  const t = video.currentTime;
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (t >= start && t <= end) return end;
    if (t < start) return i > 0 ? ranges.end(i - 1) : 0;
  }

  return ranges.end(ranges.length - 1);
}

/** All contiguous buffered ranges on the media timeline (video element time). */
export function getVideoBufferedRanges(
  video: HTMLVideoElement,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const buffered = video.buffered;
  for (let i = 0; i < buffered.length; i++) {
    ranges.push({ start: buffered.start(i), end: buffered.end(i) });
  }
  return ranges;
}

/** End of the buffered range containing the current playhead (or before it in a gap). */
export function getVideoBufferedEnd(video: HTMLVideoElement): number {
  const ranges = video.buffered;
  if (!ranges.length) return 0;

  const t = video.currentTime;
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (t >= start && t <= end) return end;
    if (t < start) return i > 0 ? ranges.end(i - 1) : 0;
  }

  return ranges.end(ranges.length - 1);
}

export function buildPlaybackTitle(
  type: "movie" | "episode",
  media: PlaybackMediaDetail,
  fileId: number,
): string {
  if (type !== "episode") {
    return media.title;
  }

  for (const season of media.seasons ?? []) {
    for (const episode of season.episodes ?? []) {
      if (episode.id !== fileId) continue;

      const episodeName =
        episode.title?.trim() || `Episode ${episode.episodeNumber}`;
      return `${media.title} — ${episodeName} (S${season.seasonNumber}E${episode.episodeNumber})`;
    }
  }

  return media.title;
}

export function findEpisode(
  media: PlaybackMediaDetail,
  fileId: number,
): TvEpisodeSummary | null {
  for (const season of media.seasons ?? []) {
    for (const episode of season.episodes ?? []) {
      if (episode.id === fileId) {
        return episode;
      }
    }
  }
  return null;
}
