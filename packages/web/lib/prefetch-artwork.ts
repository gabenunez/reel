import { api, type MediaItem } from "@/lib/api";
import { nextOptimizedImageUrl } from "@/lib/next-image-url";
import { prefetchMediaPage } from "@/lib/use-media-page-data";
import { prefetchThemeMusic } from "@/components/theme-music-player";
import { tvImageUrl } from "@/lib/tv-image";

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
  prefetchThemeMusic(item.id);
  preloadImageUrl(api.imageUrl(item.posterPath));
  // Media heroes use `sizes="100vw"`, so a 384px warm-up does not match the
  // eventual image request. Warm the desktop/TV hero-sized variant instead.
  preloadImageUrl(tvImageUrl(item.backdropPath ?? item.posterPath), 1920);
}

export function preloadPosterList(
  items: ReadonlyArray<PosterLike>,
  limit = 8,
): void {
  for (const item of items.slice(0, limit)) {
    preloadImageUrl(api.imageUrl(item.posterPath));
  }
}

/** Preload poster images for items visible in a horizontal carousel (+ nearby tiles). */
export function prefetchCarouselPosters(
  scroller: HTMLElement,
  items: ReadonlyArray<PosterLike>,
): void {
  const containerRect = scroller.getBoundingClientRect();
  const margin = 280;

  scroller.childNodes.forEach((node, index) => {
    if (!(node instanceof HTMLElement)) return;
    const item = items[index];
    if (!item) return;

    const rect = node.getBoundingClientRect();
    const inRange =
      rect.right >= containerRect.left - margin &&
      rect.left <= containerRect.right + margin;

    if (inRange) {
      preloadImageUrl(api.imageUrl(item.posterPath));
    }
  });
}
