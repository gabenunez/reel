const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
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

export interface AppSettings {
  ffmpegAvailable: boolean;
  libraries: SettingsLibrary[];
  metadata: {
    tmdbConfigured: boolean;
    tmdbApiKeyPreview: string;
    language: string;
  };
  browseShortcuts: BrowseShortcut[];
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

export const api = {
  getStatus: () => fetchApi<ServerStatus>("/api/status"),
  getHome: () =>
    fetchApi<{
      continueWatching: ContinueWatchingItem[];
      recentlyAdded: MediaItem[];
      libraries: Library[];
    }>("/api/home"),
  getLibraries: () => fetchApi<Library[]>("/api/libraries"),
  getLibraryItems: (id: number, page = 1) =>
    fetchApi<{
      items: MediaItem[];
      page: number;
      total: number;
      totalPages: number;
    }>(`/api/libraries/${id}/items?page=${page}`),
  getMedia: (id: number) => fetchApi<Record<string, unknown>>(`/api/media/${id}`),
  search: (q: string) =>
    fetchApi<{ results: MediaItem[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  scanLibrary: (id: number) =>
    fetchApi<{ success: boolean }>(`/api/libraries/${id}/scan`, {
      method: "POST",
    }),
  getSettings: () => fetchApi<AppSettings>("/api/settings"),
  browse: (path?: string) =>
    fetchApi<BrowseResult>(
      `/api/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  validatePath: (path: string) =>
    fetchApi<{ valid: boolean; error?: string; resolvedPath?: string }>(
      "/api/browse/validate",
      { method: "POST", body: JSON.stringify({ path }) },
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
  updateMetadata: (tmdb_api_key: string) =>
    fetchApi<{ success: boolean; tmdbConfigured: boolean }>(
      "/api/settings/metadata",
      { method: "PUT", body: JSON.stringify({ tmdb_api_key }) },
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
  streamUrl: (fileId: number, type: "movie" | "episode", transcode = false) => {
    if (transcode) {
      return `${API_BASE}/api/stream/${fileId}/hls/master.m3u8?type=${type}`;
    }
    return `${API_BASE}/api/stream/${fileId}?type=${type}`;
  },
  subtitleUrl: (id: number) => `${API_BASE}/api/subtitles/${id}`,
  imageUrl: (path?: string | null) => {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return `${API_BASE}${path}`;
  },
};
