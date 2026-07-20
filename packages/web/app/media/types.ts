export interface MediaEpisode {
  id: number;
  episodeNumber: number;
  title?: string | null;
  overview?: string | null;
  durationMs?: number | null;
  stillPath?: string | null;
  watchProgress?: { positionMs: number; durationMs?: number | null } | null;
}

export interface MediaSeason {
  id: number;
  seasonNumber: number;
  name?: string | null;
  episodes: MediaEpisode[];
}

export interface MediaDetail {
  id: number;
  title: string;
  overview?: string | null;
  year?: number | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  type: "movie" | "tv";
  genres?: string | null;
  rating?: number | null;
  tmdbId?: number | null;
  imdbId?: string | null;
  needsMatch?: boolean | null;
  matchConfidence?: number | null;
  isFavorite?: boolean;
  hasThemeMusic?: boolean;
  watchProgress?: { positionMs: number; durationMs?: number | null } | null;
  files?: Array<{ id: number; filePath?: string; durationMs?: number | null }>;
  seasons?: MediaSeason[];
}

export function asMediaDetail(raw: Record<string, unknown>): MediaDetail {
  return raw as unknown as MediaDetail;
}
