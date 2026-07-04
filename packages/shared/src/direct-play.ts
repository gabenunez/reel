import type { StreamQuality, TranscodeQuality } from "./stream-quality.js";

/** Codecs browsers can reliably decode in a direct progressive file stream. */
const BROWSER_DIRECT_PLAY_AUDIO_CODECS = new Set(["aac", "mp3", "mp4a"]);

/** Video codecs that HTML5 video can decode in a progressive MP4 stream. */
const BROWSER_DIRECT_PLAY_VIDEO_CODECS = new Set(["h264", "avc1"]);

/** Codecs Android TV ExoPlayer can decode in a direct progressive stream. */
const NATIVE_TV_DIRECT_PLAY_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "mp4a",
  "ac3",
  "eac3",
  "dts",
  "truehd",
]);

/** Video codecs ExoPlayer handles for direct play on Android TV. */
const NATIVE_TV_DIRECT_PLAY_VIDEO_CODECS = new Set([
  "h264",
  "avc1",
  "hevc",
  "h265",
  "vp9",
  "av1",
]);

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
  if (name === "mp4v" || name === "mpeg4" || name === "m4v" || name.startsWith("msmpeg4")) {
    return "mpeg4";
  }
  if (name === "h264" || name === "avc1" || name.includes("avc")) {
    return "h264";
  }
  if (name === "hevc" || name === "h265" || name.includes("hevc")) {
    return "hevc";
  }

  return name.split(/[._-]/)[0] ?? name;
}

/** Whether the browser can decode this audio track in a direct file stream. */
export function isBrowserDirectPlayAudioSupported(audioCodec?: string | null): boolean {
  const normalized = normalizeCodecName(audioCodec);
  if (!normalized) return false;
  return BROWSER_DIRECT_PLAY_AUDIO_CODECS.has(normalized);
}

/** Whether the browser can decode this video track in a direct file stream. */
export function isBrowserDirectPlayVideoSupported(videoCodec?: string | null): boolean {
  const normalized = normalizeCodecName(videoCodec);
  if (!normalized) return false;
  return BROWSER_DIRECT_PLAY_VIDEO_CODECS.has(normalized);
}

/** Whether ExoPlayer on Android TV can decode this audio track directly. */
export function isNativeTvDirectPlayAudioSupported(audioCodec?: string | null): boolean {
  const normalized = normalizeCodecName(audioCodec);
  if (!normalized) return false;
  if (NATIVE_TV_DIRECT_PLAY_AUDIO_CODECS.has(normalized)) return true;
  return normalized.startsWith("pcm");
}

/** Whether ExoPlayer on Android TV can decode this video track directly. */
export function isNativeTvDirectPlayVideoSupported(videoCodec?: string | null): boolean {
  const normalized = normalizeCodecName(videoCodec);
  if (!normalized) return false;
  return NATIVE_TV_DIRECT_PLAY_VIDEO_CODECS.has(normalized);
}

export function resolveNativeTvPlaybackMode(options: {
  audioCodec?: string | null;
  videoCodec?: string | null;
  transcodingEnabled: boolean;
}): OriginalPlaybackMode {
  const audioOk = isNativeTvDirectPlayAudioSupported(options.audioCodec);
  const videoOk = isNativeTvDirectPlayVideoSupported(options.videoCodec);

  if (audioOk && videoOk) {
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
  const audioOk = isBrowserDirectPlayAudioSupported(options.audioCodec);
  const videoOk = isBrowserDirectPlayVideoSupported(options.videoCodec);

  if (audioOk && videoOk) {
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
  const transcodeTiers = available.filter(
    (quality): quality is TranscodeQuality => quality !== "original",
  );

  // Prefer 1080p over 2160p for server-side transcode — realtime 4K encode is rarely viable.
  for (const quality of ["1080p", "720p", "480p", "2160p"] as const) {
    if (transcodeTiers.includes(quality)) return quality;
  }

  return transcodeTiers[0] ?? "480p";
}
