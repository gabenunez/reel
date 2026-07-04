const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let message = `API error: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export interface MediaItem {
  id: number;
  libraryId: number;
  tmdbId?: number | null;
  title: string;
  overview?: string | null;
  year?: number | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  type: "movie" | "tv";
  genres?: string | null;
  rating?: number | null;
}

export interface Library {
  id: number;
  name: string;
  type: "movies" | "tv";
  path: string;
  itemCount?: number;
  lastScannedAt?: string | null;
}

export interface SettingsLibrary extends Library {
  pathExists: boolean;
}

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  entries: BrowseEntry[];
  exists: boolean;
  isDirectory: boolean;
}

export interface BrowseShortcut {
  label: string;
  path: string;
}

export interface LibraryDeck {
  id: number;
  name: string;
  paths: string[];
  sortOrder: number;
  itemCount: number;
  libraryNames: string[];
  types?: Array<"movies" | "tv">;
  createdAt: string;
}

export interface AppSettings {
  ffmpegAvailable: boolean;
  passwordConfigured: boolean;
  libraries: SettingsLibrary[];
  decks: LibraryDeck[];
  metadata: {
    tmdbConfigured: boolean;
    tmdbApiKeyPreview: string;
    fanartConfigured: boolean;
    fanartApiKeyPreview: string;
    language: string;
  };
  subtitles: {
    opensubtitlesConfigured: boolean;
    opensubtitlesApiKeyPreview: string;
  };
  browseShortcuts: BrowseShortcut[];
}

export interface PlexImportPreview {
  detected: boolean;
  dbPath: string | null;
  candidates: string[];
  plexEntries: number;
  resumeEntries: number;
  watchedEntries: number;
  matchableEntries: number;
  reelMovieFiles: number;
  reelEpisodes: number;
  warning?: string;
}

export interface PlexImportResult {
  success: boolean;
  dbPath: string;
  imported: number;
  updated: number;
  skipped: number;
  unmatched: number;
  samples: {
    unmatchedTitles: string[];
  };
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestReleaseName: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  updateSupported: boolean;
  updateInProgress: boolean;
  installDir: string;
  updateProgress: UpdateProgress | null;
  updateCheckWarning: string | null;
}

export type UpdatePhase =
  | "preparing"
  | "downloading"
  | "building"
  | "restarting"
  | "complete"
  | "failed"
  | "unknown";

export type UpdateStepStatus = "pending" | "active" | "complete" | "failed";

export interface UpdateStep {
  id: UpdatePhase;
  label: string;
  status: UpdateStepStatus;
}

export interface UpdateProgress {
  phase: UpdatePhase;
  message: string;
  releaseTag: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  elapsedMs: number;
  steps: UpdateStep[];
  logTail: string[];
}

export interface SubtitleTrack {
  id: number;
  language: string;
  label?: string | null;
  source?: "external" | "embedded" | "opensubtitles";
}

export interface SubtitleSearchResult {
  id: string;
  fileId: number;
  language: string;
  release: string;
  downloadCount: number;
  hearingImpaired: boolean;
  fileName: string;
  fps?: number;
  uploader?: string;
}

export interface HomePlayTarget {
  type: "movie" | "episode";
  fileId: number;
  mediaId: number;
}

export interface ContinueWatchingItem {
  id: number;
  itemType: "movie" | "episode";
  itemId: number;
  mediaId: number;
  title: string;
  subtitle?: string;
  posterPath?: string | null;
  positionMs: number;
  durationMs?: number | null;
  percent: number;
}

export interface CastPrepareResponse {
  contentUrl: string;
  contentType: string;
  title: string;
  posterUrl?: string | null;
  subtitleUrl?: string | null;
  startTime: number;
  castBaseUrl: string;
}

export interface CastConfigResponse {
  requestBaseUrl: string;
  lanBaseUrl: string;
  castBaseUrl: string;
  transcodingEnabled: boolean;
}

export type StreamQuality = "original" | "480p" | "720p" | "1080p";

export interface StreamInfo {
  id: number;
  type: "movie" | "episode";
  mimeType: string;
  fileSize: number;
  fileName: string;
  filePath: string;
  isSymlink: boolean;
  symlinkTarget?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  bitrate?: number | null;
  availableQualities: StreamQuality[];
  transcodingEnabled: boolean;
  directPlayAudioSupported: boolean;
  directPlayVideoSupported?: boolean;
  originalPlaybackMode?: "direct" | "remux" | "transcode" | "unsupported";
  watchProgress?: {
    positionMs: number;
    durationMs?: number | null;
  } | null;
}

export interface ServerStatus {
  ffmpegAvailable: boolean;
  tmdbConfigured: boolean;
  libraries: Library[];
  activeScan?: {
    libraryId: number;
    libraryName: string;
    progress: number;
    status: string;
    message?: string;
  } | null;
}

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
}

export const api = {
  getAuthStatus: () => fetchApi<AuthStatus>("/api/auth/status"),
  login: (password: string) =>
    fetchApi<{ success: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    fetchApi<{ success: boolean }>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  updatePassword: (data: {
    password?: string;
    currentPassword?: string;
    remove?: boolean;
  }) =>
    fetchApi<{ success: boolean; passwordConfigured: boolean }>(
      "/api/settings/password",
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    ),
  getStatus: () => fetchApi<ServerStatus>("/api/status"),
  getHome: () =>
    fetchApi<{
      continueWatching: ContinueWatchingItem[];
      recentlyAdded: MediaItem[];
      favorites: MediaItem[];
      libraries: Library[];
      decks: LibraryDeck[];
      tmdbConfigured: boolean;
      recentPlay: HomePlayTarget | null;
    }>("/api/home"),
  getDecks: () => fetchApi<LibraryDeck[]>("/api/decks"),
  getDeck: (id: number) => fetchApi<LibraryDeck>(`/api/decks/${id}`),
  getDeckItems: (id: number, page = 1) =>
    fetchApi<{
      items: MediaItem[];
      page: number;
      total: number;
      totalPages: number;
    }>(`/api/decks/${id}/items?page=${page}`),
  getLibraries: () => fetchApi<Library[]>("/api/libraries"),
  getLibraryItems: (id: number, page = 1) =>
    fetchApi<{
      items: MediaItem[];
      page: number;
      total: number;
      totalPages: number;
    }>(`/api/libraries/${id}/items?page=${page}`),
  getMedia: (id: number) => fetchApi<Record<string, unknown>>(`/api/media/${id}`),
  getRelatedMedia: (id: number) =>
    fetchApi<{ items: MediaItem[] }>(`/api/media/${id}/related`),
  search: (q: string) =>
    fetchApi<{ results: MediaItem[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  scanLibrary: (id: number) =>
    fetchApi<{ success: boolean }>(`/api/libraries/${id}/scan`, {
      method: "POST",
    }),
  getSettings: () => fetchApi<AppSettings>("/api/settings"),
  previewPlexImport: (path?: string) =>
    fetchApi<PlexImportPreview>(
      `/api/settings/plex-import${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  importPlexWatchProgress: (data?: { plexDbPath?: string; overwrite?: boolean }) =>
    fetchApi<PlexImportResult>("/api/settings/plex-import", {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  browse: (path?: string) =>
    fetchApi<BrowseResult>(
      `/api/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  validatePath: (path: string, options?: { libraryId?: number; scope?: "library" | "deck" }) =>
    fetchApi<{ valid: boolean; error?: string; resolvedPath?: string }>(
      "/api/browse/validate",
      {
        method: "POST",
        body: JSON.stringify({ path, ...options }),
      },
    ),
  createLibrary: (data: { name: string; type: "movies" | "tv"; path: string }) =>
    fetchApi<{ success: boolean }>("/api/libraries", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateLibrary: (
    id: number,
    data: { name?: string; type?: "movies" | "tv"; path?: string },
  ) =>
    fetchApi<{ success: boolean }>(`/api/libraries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteLibrary: (id: number) =>
    fetchApi<{ success: boolean }>(`/api/libraries/${id}`, {
      method: "DELETE",
    }),
  createDeck: (data: { name: string; paths: string[]; sortOrder?: number }) =>
    fetchApi<{ success: boolean }>("/api/decks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDeck: (
    id: number,
    data: { name?: string; paths?: string[]; sortOrder?: number },
  ) =>
    fetchApi<{ success: boolean }>(`/api/decks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteDeck: (id: number) =>
    fetchApi<{ success: boolean }>(`/api/decks/${id}`, {
      method: "DELETE",
    }),
  getFavorites: (page = 1, type?: "movie" | "tv") =>
    fetchApi<{
      items: MediaItem[];
      page: number;
      total: number;
      totalPages: number;
    }>(
      `/api/favorites?page=${page}${type ? `&type=${type}` : ""}`,
    ),
  getContinueWatching: (page = 1) =>
    fetchApi<{
      items: ContinueWatchingItem[];
      page: number;
      total: number;
      totalPages: number;
    }>(`/api/continue-watching?page=${page}`),
  getRecentlyAdded: (page = 1) =>
    fetchApi<{
      items: MediaItem[];
      page: number;
      total: number;
      totalPages: number;
    }>(`/api/recent?page=${page}`),
  addFavorite: (mediaItemId: number) =>
    fetchApi<{ success: boolean }>("/api/favorites", {
      method: "POST",
      body: JSON.stringify({ mediaItemId }),
    }),
  removeFavorite: (mediaItemId: number) =>
    fetchApi<{ success: boolean }>(`/api/favorites/${mediaItemId}`, {
      method: "DELETE",
    }),
  updateMetadata: (tmdb_api_key: string) =>
    fetchApi<{
      success: boolean;
      tmdbConfigured: boolean;
      metadataRefresh?: { updated: number; skipped: number };
    }>("/api/settings/metadata", {
      method: "PUT",
      body: JSON.stringify({ tmdb_api_key }),
    }),
  updateOpenSubtitlesKey: (opensubtitles_api_key: string) =>
    fetchApi<{ success: boolean; opensubtitlesConfigured: boolean }>(
      "/api/settings/subtitles",
      {
        method: "PUT",
        body: JSON.stringify({ opensubtitles_api_key }),
      },
    ),
  updateFanartKey: (fanart_api_key: string) =>
    fetchApi<{
      success: boolean;
      fanartConfigured: boolean;
      themesSynced?: number;
    }>("/api/settings/fanart", {
      method: "PUT",
      body: JSON.stringify({ fanart_api_key }),
    }),
  listSubtitles: (fileId: number, type: "movie" | "episode") =>
    fetchApi<{
      tracks: SubtitleTrack[];
      opensubtitlesConfigured: boolean;
    }>(`/api/subtitles/list?fileId=${fileId}&type=${type}`),
  searchSubtitles: (fileId: number, type: "movie" | "episode", languages = "en") =>
    fetchApi<{
      results: SubtitleSearchResult[];
      context: {
        title: string;
        year?: number | null;
        type: "movie" | "episode";
        seasonNumber?: number;
        episodeNumber?: number;
      };
    }>(
      `/api/subtitles/search?fileId=${fileId}&type=${type}&languages=${encodeURIComponent(languages)}`,
    ),
  downloadSubtitle: (data: {
    fileId: number;
    type: "movie" | "episode";
    opensubtitlesFileId: number;
    language: string;
    release: string;
  }) =>
    fetchApi<{ success: boolean; track: SubtitleTrack }>("/api/subtitles/download", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteSubtitle: (id: number) =>
    fetchApi<{ success: boolean }>(`/api/subtitles/${id}`, {
      method: "DELETE",
    }),
  refreshMetadata: () =>
    fetchApi<{ success: boolean; updated: number; skipped: number }>(
      "/api/metadata/refresh",
      { method: "POST" },
    ),
  checkForUpdates: (force = false) =>
    fetchApi<UpdateStatus>(`/api/updates/check${force ? "?force=1" : ""}`),
  getUpdateProgress: () =>
    fetchApi<{ updateInProgress: boolean; progress: UpdateProgress | null }>(
      "/api/updates/progress",
    ),
  applyUpdate: (releaseTag?: string) =>
    fetchApi<{ success: boolean; message: string; releaseTag: string }>(
      "/api/updates/apply",
      {
        method: "POST",
        body: JSON.stringify(releaseTag ? { releaseTag } : {}),
      },
    ),
  saveProgress: (data: {
    itemType: "movie" | "episode";
    itemId: number;
    positionMs: number;
    durationMs?: number;
  }) =>
    fetchApi<{ success: boolean }>("/api/watch-progress", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getCastConfig: () => fetchApi<CastConfigResponse>("/api/cast/config"),
  prepareCast: (data: {
    fileId: number;
    type: "movie" | "episode";
    subtitleId?: number;
    title?: string;
    posterPath?: string | null;
    startTimeMs?: number;
  }) =>
    fetchApi<CastPrepareResponse>("/api/cast/prepare", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getStreamInfo: (fileId: number, type: "movie" | "episode") =>
    fetchApi<StreamInfo>(`/api/stream/${fileId}/info?type=${type}`),
  streamUrl: (
    fileId: number,
    type: "movie" | "episode",
    quality: StreamQuality = "original",
    startSeconds?: number,
    cacheKey?: number,
    hlsQuality?: StreamQuality | "remux",
  ) => {
    if (quality === "original" && !hlsQuality) {
      return `${API_BASE}/api/stream/${fileId}?type=${type}`;
    }
    const effectiveQuality = hlsQuality ?? quality;
    const params = new URLSearchParams({ type, quality: effectiveQuality });
    params.set("start", String(Math.floor(Math.max(0, startSeconds ?? 0))));
    if (cacheKey !== undefined) {
      params.set("_", String(cacheKey));
    }
    return `${API_BASE}/api/stream/${fileId}/hls/master.m3u8?${params.toString()}`;
  },
  subtitleUrl: (id: number) => `${API_BASE}/api/subtitles/${id}`,
  themeMusicUrl: (mediaId: number) => `${API_BASE}/api/media/${mediaId}/theme`,
  imageUrl: (path?: string | null) => {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return `${API_BASE}${path}`;
  },
};
