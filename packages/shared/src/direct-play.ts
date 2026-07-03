import type { StreamQuality, TranscodeQuality } from "./stream-quality.js";

/** Codecs browsers can reliably decode in a direct progressive file stream. */
const BROWSER_DIRECT_PLAY_AUDIO_CODECS = new Set(["aac", "mp3", "mp4a"]);

const HLS_VIDEO_COPY_CODECS = new Set(["h264", "avc1", "hevc", "h265"]);

export type OriginalPlaybackMode = "direct" | "remux" | "transcode" | "unsupported";

export function normalizeCodecName(codec?: string | null): string | null {
  if (!codec?.trim()) return null;

  let name = codec.toLowerCase().trim();
  if (name.startsWith("lib")) {
    name = name.slice(3);
  }

  if (name.includes("aac") || name.startsWith("mp4a")) {
    return name.startsWith("mp4a") ? "mp4a" : "aac";
  }
  if (name === "mp3" || name === "mp2") {
    return name;
  }
  if (name.includes("truehd") || name === "mlp") {
    return "truehd";
  }
  if (name.includes("eac3") || name.includes("e-ac-3")) {
    return "eac3";
  }
  if (name.includes("ac3") || name.includes("ac-3")) {
    return "ac3";
  }
  if (name.includes("dts")) {
    return "dts";
  }
  if (name.startsWith("pcm")) {
    return "pcm";
  }

  return name.split(/[._-]/)[0] ?? name;
}

/** Whether the browser can decode this audio track in a direct file stream. */
export function isBrowserDirectPlayAudioSupported(audioCodec?: string | null): boolean {
  const normalized = normalizeCodecName(audioCodec);
  if (!normalized) return false;
  return BROWSER_DIRECT_PLAY_AUDIO_CODECS.has(normalized);
}

/** Whether H.264/HEVC video can be segment-copied into browser HLS without re-encoding. */
export function isHlsVideoCopySupported(videoCodec?: string | null): boolean {
  const normalized = normalizeCodecName(videoCodec);
  if (!normalized) return false;
  return HLS_VIDEO_COPY_CODECS.has(normalized);
}

export function resolveOriginalPlaybackMode(options: {
  audioCodec?: string | null;
  videoCodec?: string | null;
  transcodingEnabled: boolean;
}): OriginalPlaybackMode {
  if (isBrowserDirectPlayAudioSupported(options.audioCodec)) {
    return "direct";
  }
  if (!options.transcodingEnabled) {
    return "unsupported";
  }
  if (isHlsVideoCopySupported(options.videoCodec)) {
    return "remux";
  }
  return "transcode";
}

export function pickTranscodeQualityForPlayback(
  available: StreamQuality[],
): TranscodeQuality {
  for (const quality of ["720p", "1080p", "480p"] as const) {
    if (available.includes(quality)) return quality;
  }

  const fallback = available.find((quality) => quality !== "original");
  return (fallback as TranscodeQuality | undefined) ?? "720p";
}
