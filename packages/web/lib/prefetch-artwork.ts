import { api, type MediaItem } from "@/lib/api";
import { nextOptimizedImageUrl } from "@/lib/next-image-url";
import { prefetchMediaPage } from "@/lib/use-media-page-data";

const inflight = new Set<string>();

/** Warm the browser image cache for a poster/backdrop URL (deduped). */
export function preloadImageUrl(
  url: string | null | undefined,
  width = 384,
): void {
  if (!url) return;
  const optimized = nextOptimizedImageUrl(url, width);
  if (inflight.has(optimized)) return;
  inflight.add(optimized);
  const img = new Image();
  img.decoding = "async";
  const done = () => inflight.delete(optimized);
  img.onload = done;
  img.onerror = done;
  img.src = optimized;
}

type PosterLike = Pick<MediaItem, "id" | "posterPath" | "backdropPath">;

/** Preload list artwork and warm the media detail JSON cache before navigation. */
export function prefetchPosterNavigation(item: PosterLike): void {
  if (!Number.isFinite(item.id)) return;
  prefetchMediaPage(item.id);
  preloadImageUrl(api.imageUrl(item.posterPath));
  preloadImageUrl(api.imageUrl(item.backdropPath ?? item.posterPath));
}

export function preloadPosterList(
  items: ReadonlyArray<PosterLike>,
  limit = 8,
): void {
  for (const item of items.slice(0, limit)) {
    preloadImageUrl(api.imageUrl(item.posterPath));
  }
}
