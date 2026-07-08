import type {
  ContinueWatchingItem,
  HomePlayTarget,
  Library,
  LibraryDeck,
  MediaItem,
} from "@/lib/api";

const INTERNAL_API_HEADER = "x-media-internal";
const INTERNAL_API_TOKEN = "next-isr";
const DEFAULT_REVALIDATE = 60;

export type PaginatedPageData<T> = {
  items: T[];
  page: number;
  total: number;
  totalPages: number;
};

export type HomeData = {
  continueWatching: ContinueWatchingItem[];
  recentlyAdded: MediaItem[];
  favorites: MediaItem[];
  libraries: Library[];
  decks: LibraryDeck[];
  tmdbConfigured: boolean;
  recentPlay: HomePlayTarget | null;
};

function internalApiBase(): string {
  if (process.env.MEDIA_INTERNAL_API_URL) {
    return process.env.MEDIA_INTERNAL_API_URL.replace(/\/$/, "");
  }
  const port = process.env.MEDIA_INTERNAL_API_PORT ?? "8097";
  return `http://127.0.0.1:${port}`;
}

async function internalApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set(INTERNAL_API_HEADER, INTERNAL_API_TOKEN);
  return fetch(`${internalApiBase()}${path}`, { ...init, headers });
}

async function fetchInternalJson<T>(
  path: string,
  revalidateSeconds = DEFAULT_REVALIDATE,
): Promise<{ data: T | null; unauthorized: boolean }> {
  try {
    const res = await internalApiFetch(path, {
      next: { revalidate: revalidateSeconds },
    });
    if (res.status === 401) return { data: null, unauthorized: true };
    if (!res.ok) return { data: null, unauthorized: false };
    return { data: (await res.json()) as T, unauthorized: false };
  } catch {
    return { data: null, unauthorized: false };
  }
}

export async function fetchMediaIds(): Promise<number[]> {
  const { data } = await fetchInternalJson<{ ids?: unknown }>("/api/media/ids", 300);
  if (!data || !Array.isArray(data.ids)) return [];
  return data.ids
    .map((id) => (typeof id === "number" ? id : parseInt(String(id), 10)))
    .filter((id) => Number.isFinite(id) && id > 0);
}

export async function fetchMediaDetail(
  mediaId: number,
  revalidateSeconds = 300,
): Promise<{
  media: Record<string, unknown> | null;
  unauthorized: boolean;
}> {
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return { media: null, unauthorized: false };
  }

  const res = await internalApiFetch(`/api/media/${mediaId}`, {
    next: { revalidate: revalidateSeconds },
  });

  if (res.status === 401) return { media: null, unauthorized: true };
  if (res.status === 404) return { media: null, unauthorized: false };
  if (!res.ok) {
    throw new Error(`Failed to fetch media ${mediaId}: ${res.status}`);
  }

  return {
    media: (await res.json()) as Record<string, unknown>,
    unauthorized: false,
  };
}

export async function fetchRelatedMedia(
  mediaId: number,
  revalidateSeconds = 300,
): Promise<Array<Record<string, unknown>>> {
  if (!Number.isFinite(mediaId) || mediaId <= 0) return [];

  const { data } = await fetchInternalJson<{ items?: unknown }>(
    `/api/media/${mediaId}/related`,
    revalidateSeconds,
  );
  return Array.isArray(data?.items)
    ? (data.items as Array<Record<string, unknown>>)
    : [];
}

export async function fetchHome(revalidateSeconds = DEFAULT_REVALIDATE) {
  return fetchInternalJson<HomeData>("/api/home", revalidateSeconds);
}

export async function fetchLibraries(revalidateSeconds = DEFAULT_REVALIDATE) {
  return fetchInternalJson<unknown[]>("/api/libraries", revalidateSeconds);
}

export async function fetchLibraryItems(
  libraryId: number,
  page = 1,
  revalidateSeconds = DEFAULT_REVALIDATE,
) {
  return fetchInternalJson<PaginatedPageData<MediaItem>>(
    `/api/libraries/${libraryId}/items?page=${page}`,
    revalidateSeconds,
  );
}

export async function fetchDeck(deckId: number, revalidateSeconds = DEFAULT_REVALIDATE) {
  return fetchInternalJson<Record<string, unknown>>(
    `/api/decks/${deckId}`,
    revalidateSeconds,
  );
}

export async function fetchDeckItems(
  deckId: number,
  page = 1,
  revalidateSeconds = DEFAULT_REVALIDATE,
) {
  return fetchInternalJson<PaginatedPageData<MediaItem>>(
    `/api/decks/${deckId}/items?page=${page}`,
    revalidateSeconds,
  );
}

export async function fetchFavorites(
  page = 1,
  type?: "movie" | "tv",
  revalidateSeconds = DEFAULT_REVALIDATE,
) {
  const query = new URLSearchParams({ page: String(page) });
  if (type) query.set("type", type);
  return fetchInternalJson<PaginatedPageData<MediaItem>>(
    `/api/favorites?${query}`,
    revalidateSeconds,
  );
}

export async function fetchContinueWatching(
  page = 1,
  revalidateSeconds = DEFAULT_REVALIDATE,
) {
  return fetchInternalJson<PaginatedPageData<ContinueWatchingItem>>(
    `/api/continue-watching?page=${page}`,
    revalidateSeconds,
  );
}

export async function fetchRecentlyAdded(
  page = 1,
  revalidateSeconds = DEFAULT_REVALIDATE,
) {
  return fetchInternalJson<PaginatedPageData<MediaItem>>(
    `/api/recent?page=${page}`,
    revalidateSeconds,
  );
}
