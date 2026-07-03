import type { StreamQuality } from "@/lib/api";

export const PROGRESS_SAVE_MS = 10_000;

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

export function pickTranscodeQualityForPlayback(
  available: StreamQuality[],
): Exclude<StreamQuality, "original"> {
  for (const quality of ["720p", "1080p", "480p"] as const) {
    if (available.includes(quality)) return quality;
  }
  const fallback = available.find((quality) => quality !== "original");
  return fallback ?? "720p";
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
