#!/usr/bin/env node
/**
 * Audit library files for playback compatibility and choppiness risk.
 *
 * Usage:
 *   node scripts/audit-playback.mjs library-files.json
 *   node scripts/audit-playback.mjs --probe library-files.json  # re-probe missing via ffprobe paths
 */
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BROWSER_AUDIO = new Set(["aac", "mp3", "mp4a"]);
const BROWSER_VIDEO = new Set(["h264", "avc1"]);
const NATIVE_TV_AUDIO = new Set(["aac", "mp3", "mp4a", "ac3", "eac3", "dts", "truehd"]);
const NATIVE_TV_VIDEO = new Set(["h264", "avc1", "hevc", "h265", "vp9", "av1"]);
const HLS_COPY_VIDEO = new Set(["h264", "avc1", "hevc", "h265"]);

function normalizeCodec(codec) {
  if (!codec?.trim()) return null;
  let name = codec.toLowerCase().trim();
  if (name.startsWith("lib")) name = name.slice(3);
  if (name.includes("aac") || name.startsWith("mp4a")) return name.startsWith("mp4a") ? "mp4a" : "aac";
  if (name === "mp3" || name === "mp2") return name;
  if (name.includes("truehd") || name === "mlp") return "truehd";
  if (name.includes("eac3") || name.includes("e-ac-3")) return "eac3";
  if (name.includes("ac3") || name.includes("ac-3")) return "ac3";
  if (name.includes("dts")) return "dts";
  if (name.startsWith("pcm")) return "pcm";
  if (name === "mp4v" || name === "mpeg4" || name === "m4v" || name.startsWith("msmpeg4")) return "mpeg4";
  if (name === "h264" || name === "avc1" || name.includes("avc")) return "h264";
  if (name === "hevc" || name === "h265" || name.includes("hevc")) return "hevc";
  return name.split(/[._-]/)[0] ?? name;
}

function browserMode(video, audio, transcoding = true) {
  const v = normalizeCodec(video);
  const a = normalizeCodec(audio);
  const audioOk = a && BROWSER_AUDIO.has(a);
  const videoOk = v && BROWSER_VIDEO.has(v);
  if (audioOk && videoOk) return "direct";
  if (!transcoding) return "unsupported";
  if (v && HLS_COPY_VIDEO.has(v)) return "remux";
  return "transcode";
}

function tvNativeMode(video, audio, transcoding = true) {
  const v = normalizeCodec(video);
  const a = normalizeCodec(audio);
  const audioOk = a && (NATIVE_TV_AUDIO.has(a) || a.startsWith("pcm"));
  const videoOk = v && NATIVE_TV_VIDEO.has(v);
  if (audioOk && videoOk) return "direct";
  if (!transcoding) return "unsupported";
  if (v && HLS_COPY_VIDEO.has(v)) return "remux";
  return "transcode";
}

function tvWebMode(video, audio, transcoding = true) {
  // TV WebView: HEVC remux when canPlayType empty; native bridge for direct when available
  const native = tvNativeMode(video, audio, transcoding);
  if (native === "direct") return "direct-native";
  if (native === "remux") return "remux-hevc-ok";
  return browserMode(video, audio, transcoding);
}

function riskFlags(file, modes) {
  const flags = [];
  const v = normalizeCodec(file.video_codec);
  const a = normalizeCodec(file.audio_codec);
  const height = file.height ?? 0;
  const size = file.file_size ?? 0;
  const bitrateMbps = file.duration_ms > 0 ? (size * 8) / file.duration_ms / 1000 : null;

  if (!v || !a) flags.push("missing-codec-metadata");
  if (modes.browser === "unsupported" || modes.tvNative === "unsupported") {
    flags.push("unsupported-no-transcode");
  }
  if (modes.browser === "transcode" || modes.tvNative === "transcode") {
    flags.push("requires-video-transcode");
  }
  if (modes.browser === "remux" && height >= 2160) {
    flags.push("browser-4k-remux-heavy");
  }
  if (modes.tvNative === "direct" && height >= 2160 && bitrateMbps && bitrateMbps > 40) {
    flags.push("4k-high-bitrate-direct");
  }
  if (modes.tvNative === "remux" && height >= 2160) {
    flags.push("tv-4k-remux");
  }
  if (v === "mpeg4" || v === "vp9" || v === "av1") {
    if (modes.browser === "transcode" || modes.tvNative === "transcode") {
      flags.push(`exotic-video-${v}`);
    }
  }
  if (a === "truehd" || a === "dts") {
    flags.push(`premium-audio-${a}-remux-or-transcode`);
  }
  if (bitrateMbps && bitrateMbps > 80) {
    flags.push("very-high-bitrate");
  }
  if (size > 30 * 1024 * 1024 * 1024) {
    flags.push("very-large-file");
  }
  if (!fs.existsSync(file.file_path)) {
    flags.push("file-missing-on-disk");
  }

  return flags;
}

async function probeFile(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath,
    ]);
    const data = JSON.parse(stdout);
    const video = data.streams?.find((s) => s.codec_type === "video");
    const audio = data.streams?.find((s) => s.codec_type === "audio");
    return {
      video_codec: video?.codec_name ?? null,
      audio_codec: audio?.codec_name ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
    };
  } catch {
    return null;
  }
}

async function main() {
  const probeMissing = process.argv.includes("--probe");
  const jsonPath = process.argv.find((a) => a.endsWith(".json"));
  if (!jsonPath) {
    console.error("Usage: node scripts/audit-playback.mjs [--probe] library-files.json");
    process.exit(1);
  }

  const files = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const results = [];
  const summary = {
    total: files.length,
    byBrowserMode: {},
    byTvNativeMode: {},
    byTvWebMode: {},
    flagCounts: {},
    issues: [],
  };

  for (const file of files) {
    let entry = { ...file };
    if (probeMissing && (!entry.video_codec || !entry.audio_codec)) {
      const probed = await probeFile(entry.file_path);
      if (probed) {
        entry = { ...entry, ...probed };
        entry.probed = true;
      }
    }

    const modes = {
      browser: browserMode(entry.video_codec, entry.audio_codec),
      tvNative: tvNativeMode(entry.video_codec, entry.audio_codec),
      tvWeb: tvWebMode(entry.video_codec, entry.audio_codec),
    };
    const flags = riskFlags(entry, modes);
    const row = {
      id: entry.id,
      type: entry.type,
      title: entry.title,
      file_path: entry.file_path,
      video: normalizeCodec(entry.video_codec),
      audio: normalizeCodec(entry.audio_codec),
      resolution: entry.height ? `${entry.width ?? "?"}x${entry.height}` : "?",
      sizeGb: entry.file_size ? (entry.file_size / 1024 ** 3).toFixed(2) : "?",
      modes,
      flags,
    };
    results.push(row);

    for (const [k, v] of Object.entries(modes)) {
      const bucket = k === "browser" ? summary.byBrowserMode : k === "tvNative" ? summary.byTvNativeMode : summary.byTvWebMode;
      bucket[v] = (bucket[v] ?? 0) + 1;
    }
    for (const flag of flags) {
      summary.flagCounts[flag] = (summary.flagCounts[flag] ?? 0) + 1;
      if (
        flag === "unsupported-no-transcode" ||
        flag === "missing-codec-metadata" ||
        flag === "file-missing-on-disk" ||
        flag === "very-high-bitrate"
      ) {
        summary.issues.push(row);
      }
    }
  }

  // Codec distribution
  const videoCodecs = {};
  const audioCodecs = {};
  for (const r of results) {
    videoCodecs[r.video ?? "unknown"] = (videoCodecs[r.video ?? "unknown"] ?? 0) + 1;
    audioCodecs[r.audio ?? "unknown"] = (audioCodecs[r.audio ?? "unknown"] ?? 0) + 1;
  }

  console.log(JSON.stringify({ summary, videoCodecs, audioCodecs, flagged: results.filter((r) => r.flags.length > 0) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
