export type LibraryType = "movies" | "tv";
export type MediaType = "movie" | "tv";
export type SubtitleSource = "external" | "embedded" | "opensubtitles";
export type ScanJobStatus = "pending" | "running" | "completed" | "failed";
export type WatchItemType = "movie" | "episode";

export interface LibraryConfig {
  name: string;
  type: LibraryType;
  path: string;
}

export interface ServerConfig {
  port: number;
  host: string;
}

export interface MetadataConfig {
  tmdb_api_key: string;
  language: string;
  fanart_api_key?: string;
}

export interface TranscodingConfig {
  enabled: boolean;
  hls_segment_duration: number;
  cache_dir: string;
}

export interface AuthConfig {
  password_hash?: string;
}

export interface SubtitlesConfig {
  opensubtitles_api_key?: string;
}

export interface AppConfig {
  server: ServerConfig;
  libraries: LibraryConfig[];
  metadata: MetadataConfig;
  transcoding: TranscodingConfig;
  data_dir: string;
  auth?: AuthConfig;
  subtitles?: SubtitlesConfig;
}

export interface ParsedMovie {
  title: string;
  year?: number;
  rawFilename: string;
}

export interface ParsedEpisode {
  showName: string;
  season: number;
  episode: number;
  rawFilename: string;
  filePath: string;
}

export interface MediaItemSummary {
  id: number;
  title: string;
  type: MediaType;
  year?: number | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string | null;
}

export interface ContinueWatchingItem {
  id: number;
  itemType: WatchItemType;
  itemId: number;
  title: string;
  subtitle?: string;
  posterPath?: string | null;
  positionMs: number;
  durationMs?: number | null;
  percent: number;
}

export interface ServerStatus {
  ffmpegAvailable: boolean;
  tmdbConfigured: boolean;
  libraries: Array<{
    id: number;
    name: string;
    type: LibraryType;
    itemCount: number;
    lastScannedAt?: string | null;
  }>;
  activeScan?: {
    libraryId: number;
    libraryName: string;
    progress: number;
    status: ScanJobStatus;
    message?: string;
  } | null;
}
