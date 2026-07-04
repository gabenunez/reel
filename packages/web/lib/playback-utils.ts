import type { StreamQuality } from "@/lib/api";
import type { StreamInfo } from "@/lib/api";
import { nativeTvPlayerAvailable } from "@/lib/android-bridge";
import {
  isBrowserDirectPlayVideoSupported,
  isHlsVideoCopySupported,
  normalizeCodecName,
  pickTranscodeQualityForPlayback,
  resolveNativeTvPlaybackMode,
  resolveOriginalPlaybackMode,
} from "@media-app/shared";

export const PROGRESS_SAVE_MS = 10_000;

export type PlaybackHlsQuality = StreamQuality | "remux";

import { isTvClient } from "@/lib/tv-mode-detect";

export { isTvClient };

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
  options?: { forceRemux?: boolean },
): ReturnType<typeof resolveOriginalPlaybackMode> {
  const mode = resolveOriginalPlaybackMode({
    audioCodec: streamInfo.audioCodec,
    videoCodec: streamInfo.videoCodec,
    transcodingEnabled: streamInfo.transcodingEnabled,
  });

  // Native ExoPlayer decodes HEVC, AC3, DTS, etc. — direct play at source resolution.
  if (nativeTvPlayerAvailable()) {
    const nativeMode = resolveNativeTvPlaybackMode({
      audioCodec: streamInfo.audioCodec,
      videoCodec: streamInfo.videoCodec,
      transcodingEnabled: streamInfo.transcodingEnabled,
    });

    if (
      options?.forceRemux &&
      nativeMode === "direct" &&
      streamInfo.transcodingEnabled &&
      isHlsVideoCopySupported(streamInfo.videoCodec)
    ) {
      return "remux";
    }

    // MKV/WebM remux is available as a native error fallback — direct play is preferred.
    return nativeMode;
  }

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
    // Android TV hardware decodes HEVC in HLS remux even when canPlayType is empty.
    if (isTvClient()) {
      return "remux";
    }
    return streamInfo.transcodingEnabled ? "transcode" : "unsupported";
  }

  return mode;
}

export function resolvePlaybackStream(
  quality: StreamQuality,
  streamInfo: StreamInfo | null,
  options?: { forceRemux?: boolean },
): {
  usingHls: boolean;
  hlsQuality?: PlaybackHlsQuality;
  audioCompatNotice: string | null;
} {
  if (quality !== "original") {
    return { usingHls: true, hlsQuality: quality, audioCompatNotice: null };
  }

  const mode = streamInfo
    ? effectiveOriginalPlaybackMode(streamInfo, options)
    : "direct";

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
    const networkQuality = pickNetworkAwareTranscodeQuality(streamInfo.availableQualities);
    const fallback =
      networkQuality && networkQuality !== "original"
        ? networkQuality
        : pickTranscodeQualityForPlayback(
            streamInfo.availableQualities,
            streamInfo.height,
          );
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
      const networkQuality = pickNetworkAwareTranscodeQuality(streamInfo.availableQualities);
      return {
        quality:
          networkQuality && networkQuality !== "original"
            ? networkQuality
            : pickTranscodeQualityForPlayback(
                streamInfo.availableQualities,
                streamInfo.height,
              ),
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
      return `${media.title}: ${episodeName} (S${season.seasonNumber}E${episode.episodeNumber})`;
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

export interface NextEpisodeInfo {
  episode: TvEpisodeSummary;
  seasonNumber: number;
}

export const WATCH_COMPLETED_FRACTION = 0.95;
export const NEXT_EPISODE_COUNTDOWN_SECONDS = 10;

/** Next episode in season order (same season, then following seasons). */
export function findNextEpisode(
  media: PlaybackMediaDetail,
  currentEpisodeId: number,
): NextEpisodeInfo | null {
  const seasons = [...(media.seasons ?? [])].sort(
    (a, b) => a.seasonNumber - b.seasonNumber,
  );

  for (let seasonIndex = 0; seasonIndex < seasons.length; seasonIndex++) {
    const season = seasons[seasonIndex];
    const episodes = [...season.episodes].sort(
      (a, b) => a.episodeNumber - b.episodeNumber,
    );

    for (let episodeIndex = 0; episodeIndex < episodes.length; episodeIndex++) {
      if (episodes[episodeIndex].id !== currentEpisodeId) continue;

      if (episodeIndex + 1 < episodes.length) {
        return {
          episode: episodes[episodeIndex + 1],
          seasonNumber: season.seasonNumber,
        };
      }

      for (let nextSeasonIndex = seasonIndex + 1; nextSeasonIndex < seasons.length; nextSeasonIndex++) {
        const nextSeason = seasons[nextSeasonIndex];
        const nextEpisodes = [...nextSeason.episodes].sort(
          (a, b) => a.episodeNumber - b.episodeNumber,
        );
        if (nextEpisodes.length > 0) {
          return {
            episode: nextEpisodes[0],
            seasonNumber: nextSeason.seasonNumber,
          };
        }
      }

      return null;
    }
  }

  return null;
}

export function formatEpisodeLabel(
  episode: TvEpisodeSummary,
  seasonNumber: number,
): string {
  const name = episode.title?.trim() || `Episode ${episode.episodeNumber}`;
  return `S${seasonNumber}E${episode.episodeNumber} · ${name}`;
}

export interface MediaSeasonProgress {
  seasonNumber: number;
  episodes: Array<
    TvEpisodeSummary & {
      durationMs?: number | null;
      watchProgress?: {
        positionMs: number;
        durationMs?: number | null;
        updatedAt?: string | number | Date | null;
      } | null;
    }
  >;
}

function watchProgressTimestamp(
  progress: NonNullable<MediaSeasonProgress["episodes"][number]["watchProgress"]>,
): number {
  if (progress.updatedAt == null) return 0;
  const time = new Date(progress.updatedAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Season tab and episode to focus on a TV show page based on watch activity. */
export function resolveNextEpisodeTarget(
  seasons: MediaSeasonProgress[],
): { seasonIndex: number; episodeId: number } | null {
  if (!seasons.length) return null;

  let bestSeasonIndex = 0;
  let bestTimestamp = -1;
  let bestSeriesOrder = -1;
  let bestEpisode: MediaSeasonProgress["episodes"][number] | null = null;

  for (let seasonIndex = 0; seasonIndex < seasons.length; seasonIndex++) {
    const season = seasons[seasonIndex];
    for (const episode of season.episodes) {
      const progress = episode.watchProgress;
      if (!progress || progress.positionMs <= 0) continue;

      const timestamp = watchProgressTimestamp(progress);
      const seriesOrder = season.seasonNumber * 10_000 + episode.episodeNumber;
      if (
        timestamp > bestTimestamp ||
        (timestamp === bestTimestamp && seriesOrder > bestSeriesOrder)
      ) {
        bestTimestamp = timestamp;
        bestSeriesOrder = seriesOrder;
        bestSeasonIndex = seasonIndex;
        bestEpisode = episode;
      }
    }
  }

  if (bestEpisode?.watchProgress) {
    const durationMs =
      bestEpisode.watchProgress.durationMs ?? bestEpisode.durationMs ?? 1;
    const completed =
      bestEpisode.watchProgress.positionMs / durationMs >= WATCH_COMPLETED_FRACTION;

    if (!completed) {
      return { seasonIndex: bestSeasonIndex, episodeId: bestEpisode.id };
    }

    const next = findNextEpisode({ title: "", seasons }, bestEpisode.id);
    if (next) {
      const nextSeasonIndex = seasons.findIndex(
        (season) => season.seasonNumber === next.seasonNumber,
      );
      return {
        seasonIndex: nextSeasonIndex >= 0 ? nextSeasonIndex : bestSeasonIndex,
        episodeId: next.episode.id,
      };
    }

    return { seasonIndex: bestSeasonIndex, episodeId: bestEpisode.id };
  }

  const orderedSeasons = seasons
    .map((season, index) => ({ season, index }))
    .sort((a, b) => a.season.seasonNumber - b.season.seasonNumber);

  for (const { season, index } of orderedSeasons) {
    const episodes = [...season.episodes].sort(
      (a, b) => a.episodeNumber - b.episodeNumber,
    );
    if (episodes[0]) {
      return { seasonIndex: index, episodeId: episodes[0].id };
    }
  }

  return null;
}

/** Season tab to show on a TV show page based on recent watch activity. */
export function resolveActiveSeasonIndex(seasons: MediaSeasonProgress[]): number {
  return resolveNextEpisodeTarget(seasons)?.seasonIndex ?? 0;
}

/** Shared hls.js config — sends session cookies on manifest + segment requests. */
export function createPlaybackHls(
  HlsConstructor: typeof import("hls.js").default,
  options?: { tv?: boolean },
) {
  const tv = options?.tv ?? isTvClient();

  return new HlsConstructor({
    backBufferLength: tv ? 60 : 90,
    maxBufferLength: tv ? 120 : 60,
    maxMaxBufferLength: tv ? 300 : 600,
    maxBufferSize: tv ? 200 * 1000 * 1000 : 60 * 1000 * 1000,
    maxBufferHole: 0.5,
    nudgeOnVideoHole: true,
    startFragPrefetch: tv,
    manifestLoadingMaxRetry: 4,
    manifestLoadingRetryDelay: 1000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 1000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    xhrSetup: (xhr) => {
      xhr.withCredentials = true;
    },
  });
}

type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
};

/** Suggest a transcode tier from Network Information API hints. */
export function pickNetworkAwareTranscodeQuality(
  availableQualities: StreamQuality[],
): StreamQuality | null {
  if (typeof navigator === "undefined") return null;

  const conn = (navigator as Navigator & { connection?: NetworkInformation })
    .connection;
  if (!conn) return null;

  if (conn.saveData) {
    if (availableQualities.includes("480p")) return "480p";
    return null;
  }

  switch (conn.effectiveType) {
    case "slow-2g":
    case "2g":
      return availableQualities.includes("480p") ? "480p" : null;
    case "3g":
      if (availableQualities.includes("720p")) return "720p";
      return availableQualities.includes("480p") ? "480p" : null;
    default:
      return null;
  }
}
