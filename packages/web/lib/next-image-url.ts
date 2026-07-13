import { withBasePath } from "./base-path";

const DEFAULT_QUALITY = 80;

/** Widths Next.js `/_next/image` accepts by default (deviceSizes + imageSizes). */
export const NEXT_IMAGE_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
] as const;

/** Snap an arbitrary width to a Next-allowed `w` so preload URLs never 400. */
export function snapNextImageWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1200;
  let best: (typeof NEXT_IMAGE_WIDTHS)[number] = NEXT_IMAGE_WIDTHS[0];
  let bestDist = Math.abs(best - width);
  for (const candidate of NEXT_IMAGE_WIDTHS) {
    const dist = Math.abs(candidate - width);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/** Build a `/_next/image` URL for warming the optimizer cache before navigation. */
export function nextOptimizedImageUrl(
  src: string,
  width: number,
  quality = DEFAULT_QUALITY,
): string {
  const params = new URLSearchParams({
    url: src,
    w: String(snapNextImageWidth(width)),
    q: String(quality),
  });
  return withBasePath(`/_next/image?${params.toString()}`);
}
