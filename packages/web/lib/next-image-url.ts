import { withBasePath } from "./base-path";

const DEFAULT_QUALITY = 80;

/** Build a `/_next/image` URL for warming the optimizer cache before navigation. */
export function nextOptimizedImageUrl(
  src: string,
  width: number,
  quality = DEFAULT_QUALITY,
): string {
  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality),
  });
  return withBasePath(`/_next/image?${params.toString()}`);
}
