import { api } from "@/lib/api";
import { isTvClient } from "@/lib/tv-mode-detect";

/** Poster/backdrop URL — requests HD cache tier on TV for sharper 4K displays. */
export function tvImageUrl(path?: string | null): string | null {
  if (!path) return null;
  return api.imageUrl(path, { hd: isTvClient() });
}
