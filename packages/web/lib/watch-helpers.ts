import type { StreamQuality } from "@/lib/api";

export interface SubtitleTrack {
  id: number;
  language: string;
  label?: string | null;
  source?: "external" | "embedded" | "opensubtitles";
}

export const QUALITY_FALLBACK_ORDER: StreamQuality[] = [
  "original",
  "1080p",
  "720p",
  "480p",
];

export function formatSubtitleLabel(sub: SubtitleTrack): string {
  const sourceLabel =
    sub.source === "opensubtitles"
      ? "Online"
      : sub.source === "embedded"
        ? "Embedded"
        : "File";
  const detail = sub.label ? sub.label.slice(0, 48) : sourceLabel;
  return `${sub.language} · ${detail}`;
}

export function qualityLabel(quality: StreamQuality, sourceHeight?: number | null): string {
  if (quality === "original") {
    if (sourceHeight && sourceHeight >= 2160) return "Original (4K)";
    if (sourceHeight && sourceHeight >= 1080) return "Original (1080p)";
    if (sourceHeight && sourceHeight >= 720) return "Original (720p)";
    return "Original";
  }
  return quality.toUpperCase();
}

export function nextFallbackQuality(
  current: StreamQuality,
  available: StreamQuality[],
): StreamQuality | null {
  const start = QUALITY_FALLBACK_ORDER.indexOf(current);
  if (start === -1) return null;

  for (let i = start + 1; i < QUALITY_FALLBACK_ORDER.length; i++) {
    const candidate = QUALITY_FALLBACK_ORDER[i];
    if (available.includes(candidate)) return candidate;
  }

  return null;
}
