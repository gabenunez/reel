import type { HlsQuality } from "@reel/shared";

export function createStreamSessionId(
  type: "movie" | "episode",
  fileId: number,
  quality: HlsQuality,
  startSeconds = 0,
): string {
  const start = Math.max(0, Math.floor(startSeconds));
  return `${type}-${fileId}-${quality}-${start}`;
}

export function createStreamSessionPrefix(
  type: "movie" | "episode",
  fileId: number,
  quality: HlsQuality,
): string {
  return `${type}-${fileId}-${quality}-`;
}

export function createStreamFilePrefix(
  type: "movie" | "episode",
  fileId: number,
): string {
  return `${type}-${fileId}-`;
}
