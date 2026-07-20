import fs from "node:fs";
import path from "node:path";
import {
  TMDB_IMAGE_BASE,
  TMDB_POSTER_SIZE,
  TMDB_BACKDROP_SIZE,
  hdImageSizeForCached,
  parseCachedImageFilename,
} from "@media-app/shared";
import type { AppConfig } from "@media-app/shared";
import PQueue from "p-queue";
import type { ConfigManager } from "../config.js";

interface TmdbSearchMovie {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
}

interface TmdbSearchTv {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
}

interface TmdbMovieDetails extends TmdbSearchMovie {
  genres?: Array<{ id: number; name: string }>;
  runtime?: number;
  imdb_id?: string | null;
  external_ids?: { imdb_id?: string | null };
}

interface TmdbTvDetails extends TmdbSearchTv {
  genres?: Array<{ id: number; name: string }>;
  number_of_seasons?: number;
  external_ids?: { imdb_id?: string | null };
}

export interface MetadataSearchCandidate {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  imdbId: string | null;
  type: "movie" | "tv";
}

/** Normalize IMDb ids / URLs to `tt#########`. */
export function parseImdbId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(
    /(?:imdb\.com\/title\/)?(tt\d{5,10})\b/i,
  );
  if (fromUrl) return fromUrl[1].toLowerCase();
  if (/^\d{5,10}$/.test(trimmed)) return `tt${trimmed}`;
  return null;
}

function yearFromDate(date?: string | null): number | null {
  if (!date || date.length < 4) return null;
  const year = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function normalizeImdbId(value?: string | null): string | null {
  if (!value) return null;
  return parseImdbId(value);
}

interface TmdbSeasonDetails {
  season_number: number;
  name?: string;
  overview?: string;
  poster_path?: string;
  air_date?: string;
  episodes?: Array<{
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string;
    air_date?: string;
    runtime?: number;
  }>;
}

export class MetadataService {
  private queue = new PQueue({ concurrency: 4, interval: 250, intervalCap: 4 });
  private imageCacheDir: string;

  constructor(private configManager: ConfigManager) {
    this.imageCacheDir = path.join(configManager.get().data_dir, "cache", "images");
    fs.mkdirSync(this.imageCacheDir, { recursive: true });
  }

  setApiKey(apiKey: string): void {
    this.configManager.setTmdbApiKey(apiKey);
  }

  private get config(): AppConfig {
    return this.configManager.get();
  }

  private get apiKey(): string {
    return this.config.metadata.tmdb_api_key;
  }

  private get language(): string {
    return this.config.metadata.language;
  }

  private async fetchTmdb<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("language", this.language);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async searchMovie(title: string, year?: number): Promise<{
    match: TmdbMovieDetails | null;
    confidence: number;
  }> {
    if (!this.apiKey || this.apiKey === "YOUR_KEY_HERE" || this.apiKey.trim() === "") {
      return { match: null, confidence: 0 };
    }

    return this.queue.add(async () => {
      const data = await this.fetchTmdb<{ results: TmdbSearchMovie[] }>(
        "/search/movie",
        { query: title, ...(year ? { year: String(year) } : {}) },
      );

      if (!data.results?.length) return { match: null, confidence: 0 };

      const best = data.results[0];
      let confidence = 0.7;

      const titleLower = title.toLowerCase();
      if (best.title.toLowerCase() === titleLower) confidence += 0.2;
      else if (best.title.toLowerCase().includes(titleLower)) confidence += 0.1;

      if (year && best.release_date) {
        const matchYear = parseInt(best.release_date.slice(0, 4), 10);
        if (matchYear === year) confidence += 0.1;
        else if (Math.abs(matchYear - year) <= 1) confidence += 0.05;
      }

      const details = await this.fetchTmdb<TmdbMovieDetails>(`/movie/${best.id}`);
      return { match: details, confidence: Math.min(confidence, 1) };
    }) as Promise<{ match: TmdbMovieDetails | null; confidence: number }>;
  }

  async searchTv(showName: string): Promise<{
    match: TmdbTvDetails | null;
    confidence: number;
  }> {
    if (!this.apiKey || this.apiKey === "YOUR_KEY_HERE" || this.apiKey.trim() === "") {
      return { match: null, confidence: 0 };
    }

    return this.queue.add(async () => {
      const data = await this.fetchTmdb<{ results: TmdbSearchTv[] }>(
        "/search/tv",
        { query: showName },
      );

      if (!data.results?.length) return { match: null, confidence: 0 };

      const best = data.results[0];
      let confidence = 0.7;

      const nameLower = showName.toLowerCase();
      if (best.name.toLowerCase() === nameLower) confidence += 0.25;
      else if (best.name.toLowerCase().includes(nameLower)) confidence += 0.1;

      const details = await this.fetchTmdb<TmdbTvDetails>(`/tv/${best.id}`);
      return { match: details, confidence: Math.min(confidence, 1) };
    }) as Promise<{ match: TmdbTvDetails | null; confidence: number }>;
  }

  async getTvdbId(tmdbId: number): Promise<number | null> {
    if (!this.apiKey || this.apiKey === "YOUR_KEY_HERE") return null;

    return this.queue.add(async () => {
      try {
        const data = await this.fetchTmdb<{ tvdb_id?: number | null }>(
          `/tv/${tmdbId}/external_ids`,
        );
        return data.tvdb_id ?? null;
      } catch {
        return null;
      }
    }) as Promise<number | null>;
  }

  async getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails | null> {
    if (!this.isConfigured()) return null;
    return this.queue.add(async () => {
      try {
        return await this.fetchTmdb<TmdbMovieDetails>(`/movie/${tmdbId}`, {
          append_to_response: "external_ids",
        });
      } catch {
        return null;
      }
    }) as Promise<TmdbMovieDetails | null>;
  }

  async getTvDetails(tmdbId: number): Promise<TmdbTvDetails | null> {
    if (!this.isConfigured()) return null;
    return this.queue.add(async () => {
      try {
        return await this.fetchTmdb<TmdbTvDetails>(`/tv/${tmdbId}`, {
          append_to_response: "external_ids",
        });
      } catch {
        return null;
      }
    }) as Promise<TmdbTvDetails | null>;
  }

  /**
   * Search TMDB for rematch candidates. Accepts a title (+ optional year)
   * or an IMDb id / URL (tt0094715).
   */
  async searchCandidates(options: {
    query: string;
    year?: number;
    type: "movie" | "tv";
    limit?: number;
  }): Promise<MetadataSearchCandidate[]> {
    if (!this.isConfigured()) return [];

    const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);
    const imdbId = parseImdbId(options.query);

    if (imdbId) {
      const found = await this.findByImdbId(imdbId, options.type);
      return found ? [found] : [];
    }

    const query = options.query.trim();
    if (query.length < 1) return [];

    return this.queue.add(async () => {
      if (options.type === "movie") {
        const data = await this.fetchTmdb<{ results: TmdbSearchMovie[] }>(
          "/search/movie",
          {
            query,
            ...(options.year ? { year: String(options.year) } : {}),
          },
        );
        const top = (data.results ?? []).slice(0, limit);
        return Promise.all(
          top.map(async (item) => {
            const imdb = await this.fetchImdbId("movie", item.id);
            return {
              tmdbId: item.id,
              title: item.title,
              year: yearFromDate(item.release_date),
              overview: item.overview ?? null,
              posterPath: item.poster_path ?? null,
              imdbId: imdb,
              type: "movie" as const,
            };
          }),
        );
      }

      const data = await this.fetchTmdb<{ results: TmdbSearchTv[] }>(
        "/search/tv",
        { query },
      );
      const top = (data.results ?? []).slice(0, limit);
      return Promise.all(
        top.map(async (item) => {
          const imdb = await this.fetchImdbId("tv", item.id);
          return {
            tmdbId: item.id,
            title: item.name,
            year: yearFromDate(item.first_air_date),
            overview: item.overview ?? null,
            posterPath: item.poster_path ?? null,
            imdbId: imdb,
            type: "tv" as const,
          };
        }),
      );
    }) as Promise<MetadataSearchCandidate[]>;
  }

  private async fetchImdbId(
    type: "movie" | "tv",
    tmdbId: number,
  ): Promise<string | null> {
    try {
      const data = await this.fetchTmdb<{ imdb_id?: string | null }>(
        `/${type}/${tmdbId}/external_ids`,
      );
      return normalizeImdbId(data.imdb_id);
    } catch {
      return null;
    }
  }

  private async findByImdbId(
    imdbId: string,
    preferredType: "movie" | "tv",
  ): Promise<MetadataSearchCandidate | null> {
    return this.queue.add(async () => {
      try {
        const data = await this.fetchTmdb<{
          movie_results?: TmdbSearchMovie[];
          tv_results?: TmdbSearchTv[];
        }>(`/find/${imdbId}`, { external_source: "imdb_id" });

        if (preferredType === "movie" && data.movie_results?.[0]) {
          const item = data.movie_results[0];
          return {
            tmdbId: item.id,
            title: item.title,
            year: yearFromDate(item.release_date),
            overview: item.overview ?? null,
            posterPath: item.poster_path ?? null,
            imdbId,
            type: "movie",
          };
        }
        if (preferredType === "tv" && data.tv_results?.[0]) {
          const item = data.tv_results[0];
          return {
            tmdbId: item.id,
            title: item.name,
            year: yearFromDate(item.first_air_date),
            overview: item.overview ?? null,
            posterPath: item.poster_path ?? null,
            imdbId,
            type: "tv",
          };
        }
        // Fall through to the other media type if preferred is empty.
        if (data.movie_results?.[0]) {
          const item = data.movie_results[0];
          return {
            tmdbId: item.id,
            title: item.title,
            year: yearFromDate(item.release_date),
            overview: item.overview ?? null,
            posterPath: item.poster_path ?? null,
            imdbId,
            type: "movie",
          };
        }
        if (data.tv_results?.[0]) {
          const item = data.tv_results[0];
          return {
            tmdbId: item.id,
            title: item.name,
            year: yearFromDate(item.first_air_date),
            overview: item.overview ?? null,
            posterPath: item.poster_path ?? null,
            imdbId,
            type: "tv",
          };
        }
        return null;
      } catch {
        return null;
      }
    }) as Promise<MetadataSearchCandidate | null>;
  }

  async getTvSeason(tmdbId: number, seasonNumber: number): Promise<TmdbSeasonDetails | null> {
    if (!this.apiKey || this.apiKey === "YOUR_KEY_HERE") return null;

    return this.queue.add(async () => {
      try {
        return await this.fetchTmdb<TmdbSeasonDetails>(
          `/tv/${tmdbId}/season/${seasonNumber}`,
        );
      } catch {
        return null;
      }
    }) as Promise<TmdbSeasonDetails | null>;
  }

  async cacheImage(
    imagePath: string | null | undefined,
    size: string = TMDB_POSTER_SIZE,
  ): Promise<string | null> {
    if (!imagePath) return null;

    const filename = `${size}${imagePath.replace(/\//g, "_")}`;
    const localPath = path.join(this.imageCacheDir, filename);

    if (fs.existsSync(localPath)) {
      return `/api/images/${filename}`;
    }

    const url = `${TMDB_IMAGE_BASE}/${size}${imagePath}`;

    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(localPath, buffer);
      return `/api/images/${filename}`;
    } catch {
      return null;
    }
  }

  async cachePoster(imagePath?: string | null): Promise<string | null> {
    return this.cacheImage(imagePath, TMDB_POSTER_SIZE);
  }

  async cacheBackdrop(imagePath?: string | null): Promise<string | null> {
    return this.cacheImage(imagePath, TMDB_BACKDROP_SIZE);
  }

  /** Upgrade a cached image to an HD TMDB tier when a TV client requests ?hd=1. */
  async resolveHdImageFilename(filename: string): Promise<string> {
    const parsed = parseCachedImageFilename(filename);
    if (!parsed) return filename;

    const targetSize = hdImageSizeForCached(parsed.size);
    if (!targetSize || targetSize === parsed.size) return filename;

    const hdPath = await this.cacheImage(parsed.imagePath, targetSize);
    if (!hdPath) return filename;

    return hdPath.replace(/^\/api\/images\//, "");
  }

  isConfigured(): boolean {
    const key = this.apiKey?.trim();
    return Boolean(key && key !== "YOUR_KEY_HERE");
  }
}

export type { TmdbMovieDetails, TmdbTvDetails, TmdbSeasonDetails };
