export type StreamQuality = "original" | "480p" | "720p" | "1080p";

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
};

export function parseTranscodeQuality(value?: string | null): TranscodeQuality | null {
  if (value === "480p" || value === "720p" || value === "1080p") {
    return value;
  }
  return null;
}

export function parseHlsQuality(value?: string | null): HlsQuality | null {
  if (value === "remux") return "remux";
  return parseTranscodeQuality(value);
}

export function getAvailableQualities(sourceHeight?: number | null): StreamQuality[] {
  const qualities: StreamQuality[] = ["original"];
  if (!sourceHeight) {
    return ["original", "480p", "720p", "1080p"];
  }
  // Always offer 480p transcode for sub-SD sources (e.g. 368p phone rips) — output
  // height is capped to source via effectiveTranscodeHeight().
  if (sourceHeight > 0) qualities.push("480p");
  if (sourceHeight >= 720) qualities.push("720p");
  if (sourceHeight >= 1080) qualities.push("1080p");
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

export function qualityLabel(quality: StreamQuality, sourceHeight?: number | null): string {
  if (quality === "original") {
    if (sourceHeight && sourceHeight >= 2160) return "Original (4K)";
    if (sourceHeight && sourceHeight >= 1080) return "Original (1080p)";
    if (sourceHeight && sourceHeight >= 720) return "Original (720p)";
    return "Original";
  }
  return TRANSCODE_PRESETS[quality].label;
}
