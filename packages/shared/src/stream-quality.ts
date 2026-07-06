export type StreamQuality = "original" | "480p" | "720p" | "1080p" | "2160p";

export type TranscodeQuality = Exclude<StreamQuality, "original">;

/** HLS session quality — includes remux (source video + AAC audio). */
export type HlsQuality = TranscodeQuality | "remux";

export interface TranscodePreset {
  label: string;
  maxHeight: number;
  crf: number;
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
  h264Level: string;
}

export const TRANSCODE_PRESETS: Record<TranscodeQuality, TranscodePreset> = {
  "480p": {
    label: "480p",
    maxHeight: 480,
    crf: 26,
    maxrate: "1500k",
    bufsize: "3000k",
    audioBitrate: "96k",
    h264Level: "3.1",
  },
  "720p": {
    label: "720p",
    maxHeight: 720,
    crf: 23,
    maxrate: "3500k",
    bufsize: "7000k",
    audioBitrate: "128k",
    h264Level: "3.1",
  },
  "1080p": {
    label: "1080p",
    maxHeight: 1080,
    crf: 21,
    maxrate: "8000k",
    bufsize: "16000k",
    audioBitrate: "192k",
    h264Level: "4.0",
  },
  "2160p": {
    label: "4K",
    maxHeight: 2160,
    crf: 19,
    maxrate: "25000k",
    bufsize: "50000k",
    audioBitrate: "256k",
    h264Level: "5.1",
  },
};

export function is4KSource(
  sourceHeight?: number | null,
  sourceWidth?: number | null,
): boolean {
  return (
    (sourceHeight != null && sourceHeight >= 2160) ||
    (sourceWidth != null && sourceWidth >= 3840)
  );
}

/** Standard tier thresholds — width matters for letterboxed/widescreen 1080p (e.g. 1920×800). */
export function getSourceResolutionTier(
  sourceHeight?: number | null,
  sourceWidth?: number | null,
): 480 | 720 | 1080 | 2160 | null {
  if (is4KSource(sourceHeight, sourceWidth)) return 2160;
  if ((sourceHeight ?? 0) >= 1080 || (sourceWidth ?? 0) >= 1920) return 1080;
  if ((sourceHeight ?? 0) >= 720 || (sourceWidth ?? 0) >= 1280) return 720;
  if ((sourceHeight ?? 0) > 0 || (sourceWidth ?? 0) > 0) return 480;
  return null;
}

export function tierToTranscodeQuality(tier: 480 | 720 | 1080 | 2160): TranscodeQuality {
  if (tier === 2160) return "2160p";
  if (tier === 1080) return "1080p";
  if (tier === 720) return "720p";
  return "480p";
}

export function parseTranscodeQuality(value?: string | null): TranscodeQuality | null {
  if (
    value === "480p" ||
    value === "720p" ||
    value === "1080p" ||
    value === "2160p"
  ) {
    return value;
  }
  return null;
}

export function parseHlsQuality(value?: string | null): HlsQuality | null {
  if (value === "remux") return "remux";
  return parseTranscodeQuality(value);
}

export function getAvailableQualities(
  sourceHeight?: number | null,
  sourceWidth?: number | null,
): StreamQuality[] {
  const qualities: StreamQuality[] = ["original"];
  if (!sourceHeight && !sourceWidth) {
    return ["original", "480p", "720p", "1080p"];
  }
  const tier = getSourceResolutionTier(sourceHeight, sourceWidth);
  // Always offer 480p transcode for sub-SD sources (e.g. 368p phone rips) — output
  // height is capped to source via effectiveTranscodeHeight().
  if (tier != null) qualities.push("480p");
  if (tier != null && tier >= 720) qualities.push("720p");
  if (tier != null && tier >= 1080) qualities.push("1080p");
  if (tier === 2160) qualities.push("2160p");
  return qualities;
}

export function effectiveTranscodeHeight(
  quality: TranscodeQuality,
  sourceHeight?: number | null,
): number {
  const preset = TRANSCODE_PRESETS[quality];
  if (!sourceHeight) return preset.maxHeight;
  return Math.min(preset.maxHeight, sourceHeight);
}

export function qualityLabel(
  quality: StreamQuality,
  sourceHeight?: number | null,
  sourceWidth?: number | null,
): string {
  if (quality === "original") {
    const tier = getSourceResolutionTier(sourceHeight, sourceWidth);
    if (tier === 2160) return "Original (4K)";
    if (tier === 1080) return "Original (1080p)";
    if (tier === 720) return "Original (720p)";
    return "Original";
  }
  return TRANSCODE_PRESETS[quality].label;
}
