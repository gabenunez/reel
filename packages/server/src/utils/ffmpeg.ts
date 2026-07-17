import { execFile, execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { HlsQuality, TranscodeQuality } from "@media-app/shared";
import {
  TRANSCODE_PRESETS,
  effectiveTranscodeHeight,
  buildTranscodeVideoFilter,
  parseVideoDynamicRangeFromStream,
  type VideoDynamicRange,
} from "@media-app/shared";
import { createStreamFilePrefix } from "./stream-session.js";

const execFileAsync = promisify(execFile);
const MAX_CONCURRENT_TRANSCODES = 4;
// A well-buffered 4K client may go several minutes without requesting a new
// playlist or segment. Do not kill its encoder while playback is still valid.
const IDLE_SESSION_MS = 10 * 60 * 1000;
/**
 * A session accessed within this window is considered actively serving a
 * client and must never be reclaimed for capacity or reaped by same-file
 * cleanup — killing it mid-encode leaves a partial playlist and freezes that
 * viewer's playback.
 *
 * Must stay above client max buffer (native ExoPlayer uses 120s) so a
 * well-buffered viewer who is not polling still counts as active. Idle
 * cleanup (IDLE_SESSION_MS) remains the hard ceiling.
 */
const ACTIVELY_SERVING_MS = 5 * 60 * 1000;
export const PRUNE_CACHE_MS = 60 * 60 * 1000;
const FFMPEG_CACHE_MS = 5 * 60 * 1000;
let ffmpegAvailabilityCache: { available: boolean; checkedAt: number } | null = null;
/** Max segments retained on disk and in the live playlist (~30 min at 6 s). */
export const HLS_PLAYLIST_WINDOW_SEGMENTS = 300;

export interface ProbeResult {
  durationMs: number;
  videoCodec?: string;
  audioCodec?: string;
  audioStreamIndex?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  dynamicRange: VideoDynamicRange;
  subtitleStreams: Array<{
    index: number;
    language?: string;
    title?: string;
    codec?: string;
  }>;
}

type FfprobeStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  disposition?: { default?: number; original?: number };
  tags?: { language?: string; title?: string };
  side_data_list?: Array<{
    side_data_type?: string;
    dv_profile?: number;
  }>;
};

function parseSampleAspectRatio(value?: string): number | null {
  if (!value || value === "0:1" || value === "N/A") return null;
  const [numRaw, denRaw] = value.split(":");
  const num = Number(numRaw);
  const den = Number(denRaw);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) {
    return null;
  }
  return num / den;
}

/** Coded size × SAR — e.g. 1440×1080 with 4:3 SAR → 1920×1080 display width. */
function displayDimensionsFromStream(stream: FfprobeStream | undefined): {
  width?: number;
  height?: number;
} {
  const codedWidth = stream?.width;
  const codedHeight = stream?.height;
  if (!codedWidth || !codedHeight) {
    return { width: codedWidth, height: codedHeight };
  }

  const sar = parseSampleAspectRatio(stream.sample_aspect_ratio);
  if (sar && Math.abs(sar - 1) > 0.001) {
    return {
      width: Math.round(codedWidth * sar),
      height: codedHeight,
    };
  }

  return { width: codedWidth, height: codedHeight };
}

function scoreAudioStream(stream: FfprobeStream): number {
  let score = 0;
  if (stream.disposition?.default) score += 100;
  if (stream.disposition?.original) score += 50;

  const title = stream.tags?.title ?? "";
  if (/(commentary|descr|description|visual impaired|hi)/i.test(title)) {
    score -= 200;
  }

  return score;
}

function pickAudioStream(
  streams: FfprobeStream[] | undefined,
): FfprobeStream | null {
  const audioStreams = (streams ?? []).filter((s) => s.codec_type === "audio");
  if (!audioStreams.length) return null;

  return [...audioStreams].sort(
    (a, b) => scoreAudioStream(b) - scoreAudioStream(a),
  )[0];
}

function audioMapArgs(audioStreamIndex?: number | null): string[] {
  if (audioStreamIndex != null && audioStreamIndex >= 0) {
    return ["-map", `0:${audioStreamIndex}`];
  }
  return ["-map", "0:a:0?"];
}

export async function checkFfmpegAvailable(): Promise<boolean> {
  const now = Date.now();
  if (
    ffmpegAvailabilityCache &&
    now - ffmpegAvailabilityCache.checkedAt < FFMPEG_CACHE_MS
  ) {
    return ffmpegAvailabilityCache.available;
  }

  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
    ffmpegAvailabilityCache = { available: true, checkedAt: now };
    return true;
  } catch {
    ffmpegAvailabilityCache = { available: false, checkedAt: now };
    return false;
  }
}

export async function probeFile(filePath: string): Promise<ProbeResult | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    const data = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: FfprobeStream[];
    };

    const videoStream = data.streams?.find((s) => s.codec_type === "video");
    const display = displayDimensionsFromStream(videoStream);
    const audioStream = pickAudioStream(data.streams);
    const subtitleStreams =
      data.streams
        ?.map((s, index) => ({ ...s, index }))
        .filter((s) => s.codec_type === "subtitle")
        .map((s) => ({
          index: s.index,
          language: s.tags?.language,
          title: s.tags?.title,
          codec: s.codec_name,
        })) ?? [];

    const durationSec = parseFloat(data.format?.duration ?? "0");

    return {
      durationMs: Math.round(durationSec * 1000),
      videoCodec: videoStream?.codec_name,
      audioCodec: audioStream?.codec_name,
      audioStreamIndex: audioStream?.index,
      width: display.width,
      height: display.height,
      bitrate: data.format?.bit_rate
        ? parseInt(data.format.bit_rate, 10)
        : undefined,
      dynamicRange: parseVideoDynamicRangeFromStream(videoStream),
      subtitleStreams,
    };
  } catch {
    return null;
  }
}

export function extractEmbeddedSubtitle(
  filePath: string,
  streamIndex: number,
  outputPath: string,
  timeoutMs = 120_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      filePath,
      "-map",
      `0:${streamIndex}`,
      "-f",
      "webvtt",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Subtitle extraction timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath)) resolve();
      else reject(new Error(`Failed to extract subtitle stream ${streamIndex}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export interface HlsSession {
  id: string;
  process: ChildProcess | null;
  outputDir: string;
  playlistPath: string;
  lastAccess: number;
  /** Highest segment index the client has actually requested — segments below
   * this (minus the retention window) are safe to prune. Encoding can outrun
   * playback (no `-re` throttling), so pruning must track consumption, not
   * just how many segments ffmpeg has written. */
  lastServedSegmentIndex: number;
}

const activeSessions = new Map<string, HlsSession>();

export function readStartOffset(outputDir: string): number {
  try {
    const marker = path.join(outputDir, ".start-offset");
    if (!fs.existsSync(marker)) return 0;
    const value = JSON.parse(fs.readFileSync(marker, "utf8")) as number;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeStartOffset(outputDir: string, startSeconds: number): void {
  fs.writeFileSync(
    path.join(outputDir, ".start-offset"),
    JSON.stringify(startSeconds),
  );
}

function writeExitCode(outputDir: string, code: number | null): void {
  try {
    fs.writeFileSync(path.join(outputDir, ".exit-code"), String(code ?? -1));
  } catch (err) {
    // stopHlsSession intentionally removes a killed session directory. The
    // child close event can arrive afterward; never let that async bookkeeping
    // failure crash the API during an orderly restart.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to record FFmpeg exit code for ${outputDir}:`, err);
    }
  }
}

function readExitCode(outputDir: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(outputDir, ".exit-code"), "utf8").trim();
    const code = parseInt(raw, 10);
    return Number.isFinite(code) ? code : null;
  } catch {
    return null;
  }
}

function isTranscodeOutputComplete(outputDir: string): boolean {
  const exitCode = readExitCode(outputDir);
  if (exitCode !== null) {
    return exitCode === 0;
  }
  // Legacy cache dirs from before .exit-code tracking — require segments too.
  if (!hasCompleteHlsPlaylist(outputDir)) {
    return false;
  }
  return listHlsSegments(outputDir).length > 0;
}

/**
 * True only when the transcode reached the true end of the source: ffmpeg
 * exited cleanly AND (when we know the source duration) the produced segments
 * actually cover it. A SIGTERM'd/crashed transcode fails this even though its
 * playlist file may contain a (bogus) #EXT-X-ENDLIST, so callers must use this
 * — never ffmpeg's ENDLIST — to decide whether a stream is really finished.
 */
export function isTranscodeComplete(
  outputDir: string,
  sourceDurationSeconds = 0,
): boolean {
  if (!isTranscodeOutputComplete(outputDir)) return false;

  if (sourceDurationSeconds <= 0) return true;

  let raw: string;
  try {
    raw = fs.readFileSync(path.join(outputDir, "master.m3u8"), "utf-8");
  } catch {
    return false;
  }
  const parsed = parseFfmpegPlaylist(raw);
  if (!parsed) return false;

  const produced = sumPlaylistDurationSeconds(parsed.segments);
  const startOffset = readStartOffset(outputDir);
  const remaining = Math.max(0, sourceDurationSeconds - startOffset);
  // Allow a one-segment tolerance for rounding / final short segment.
  return produced >= remaining - 8;
}

export function clearTranscodeOutput(outputDir: string): void {
  if (!fs.existsSync(outputDir)) return;
  for (const entry of fs.readdirSync(outputDir)) {
    try {
      fs.unlinkSync(path.join(outputDir, entry));
    } catch {
      // file may be in use by ffmpeg — will be cleaned on next retry
    }
  }
}

function sleepMs(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    return;
  } catch {
    // Atomics.wait may be unavailable on some runtimes — fall through
  }

  try {
    execSync(`sleep ${ms / 1000}`, { stdio: "ignore", timeout: ms + 100 });
    return;
  } catch {
    // execSync unavailable or timed out — final fallback
  }

  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    } catch {
      // Very old Node without Atomics.wait — yield via Date check only
      // Intentionally minimal spin; this path is only reached in degraded envs
      // eslint-disable-next-line no-empty
      for (let i = 0; i < 1_000; i++) {}
    }
  }
}

function killFfmpegInDir(outputDir: string): void {
  try {
    const stdout = execSync("pgrep -af ffmpeg || true", { encoding: "utf8" });
    for (const line of stdout.split("\n")) {
      if (!line.includes(outputDir)) continue;
      const pid = parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // process already exited
      }
    }
  } catch {
    // pgrep unavailable
  }
}

function removeTranscodeDirContents(dir: string): void {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      removeTranscodeDirContents(full);
      try {
        fs.rmdirSync(full);
      } catch {
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
      }
    } else {
      try {
        fs.unlinkSync(full);
      } catch {
        // ignore busy files; outer retries will try again
      }
    }
  }
}

/** Best-effort cache cleanup — never throws (transcode cleanup must not crash the server). */
export function removeTranscodeDir(outputDir: string): boolean {
  if (!fs.existsSync(outputDir)) return true;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      killFfmpegInDir(outputDir);
      sleepMs(150 * attempt);
    }

    try {
      fs.rmSync(outputDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      return !fs.existsSync(outputDir);
    } catch {
      try {
        removeTranscodeDirContents(outputDir);
        fs.rmdirSync(outputDir);
        return true;
      } catch {
        // retry outer loop — ffmpeg may still hold a file handle
      }
    }
  }

  // Last resort: try to clean individual files; even partial cleanup frees space
  try {
    for (const entry of fs.readdirSync(outputDir)) {
      try {
        fs.unlinkSync(path.join(outputDir, entry));
      } catch {
        // skip busy file
      }
    }
  } catch {
    // dir already gone or unreadable
  }

  return !fs.existsSync(outputDir);
}

export function startHlsTranscode(
  sessionId: string,
  filePath: string,
  outputDir: string,
  segmentDuration: number,
  quality: TranscodeQuality,
  sourceHeight?: number | null,
  startSeconds = 0,
  audioStreamIndex?: number | null,
  dynamicRange?: VideoDynamicRange | null,
): HlsSession {
  enforceTranscodeCapacity(sessionId);
  stopHlsSession(sessionId);
  fs.mkdirSync(outputDir, { recursive: true });
  const playlistPath = `${outputDir}/master.m3u8`;
  const preset = TRANSCODE_PRESETS[quality];
  const height = effectiveTranscodeHeight(quality, sourceHeight);

  clearTranscodeOutput(outputDir);
  writeStartOffset(outputDir, startSeconds);

  const logPath = `${outputDir}/ffmpeg.log`;
  const logStream = fs.openSync(logPath, "a");
  let logClosed = false;
  const closeLog = () => {
    if (!logClosed) {
      logClosed = true;
      fs.closeSync(logStream);
    }
  };

  const args = ["-y"];
  if (startSeconds > 0) {
    args.push("-ss", String(startSeconds));
  }
  // 4K re-encodes must stay ahead of realtime or the client buffer never grows.
  // Prefer speed over compression efficiency at 2160p; lower tiers keep veryfast.
  const x264Preset = quality === "2160p" ? "ultrafast" : "veryfast";
  const x264Tune = quality === "2160p" ? ["-tune", "zerolatency"] : [];

  args.push(
    "-i",
    filePath,
    "-map",
    "0:v:0",
    ...audioMapArgs(audioStreamIndex),
    "-fflags",
    "+genpts",
    "-vf",
    buildTranscodeVideoFilter(height, dynamicRange, sourceHeight),
    "-c:v",
    "libx264",
    "-profile:v",
    "main",
    "-level",
    preset.h264Level,
    "-pix_fmt",
    "yuv420p",
    "-preset",
    x264Preset,
    ...x264Tune,
    "-threads",
    "0",
    "-crf",
    String(preset.crf),
    "-maxrate",
    preset.maxrate,
    "-bufsize",
    preset.bufsize,
    // Force a keyframe exactly at every segment boundary so ffmpeg emits
    // uniform, on-target segments instead of GOP-aligned segments that can be
    // far longer than -hls_time (a long source GOP otherwise yields 10s+
    // segments, breaking client buffer/live-edge math).
    "-force_key_frames",
    `expr:gte(t,n_forced*${segmentDuration})`,
    "-c:a",
    "aac",
    "-b:a",
    preset.audioBitrate,
    "-ac",
    "2",
    "-ar",
    "48000",
    "-f",
    "hls",
    "-hls_time",
    String(segmentDuration),
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "independent_segments+append_list",
    "-hls_segment_filename",
    `${outputDir}/segment_%03d.ts`,
    playlistPath,
  );

  const process = spawn("ffmpeg", args, {
    stdio: ["ignore", logStream, logStream],
  });

  const session: HlsSession = {
    id: sessionId,
    process,
    outputDir,
    playlistPath,
    lastAccess: Date.now(),
    lastServedSegmentIndex: -1,
  };

  activeSessions.set(sessionId, session);

  process.on("close", (code) => {
    closeLog();
    writeExitCode(outputDir, code);
    activeSessions.delete(sessionId);
    if (code !== 0 && code !== null) {
      console.warn(`HLS transcode exited with code ${code} for session ${sessionId}`);
    }
  });

  process.on("error", (err) => {
    closeLog();
    writeExitCode(outputDir, -1);
    activeSessions.delete(sessionId);
    console.warn(`HLS transcode failed for session ${sessionId}:`, err.message);
  });

  return session;
}

function needsAnnexBBitstream(ext: string): boolean {
  return ext !== ".ts" && ext !== ".m2ts" && ext !== ".mts";
}

function hlsVideoCopyArgs(videoCodec?: string | null, filePath?: string): string[] {
  const normalized = videoCodec?.toLowerCase().split(".")[0]?.split("_")[0];
  const ext = filePath?.toLowerCase().slice(filePath.lastIndexOf(".")) ?? "";

  if (normalized === "h264" || normalized === "avc1") {
    const args = ["-c:v", "copy"];
    if (needsAnnexBBitstream(ext)) {
      args.push("-bsf:v", "h264_mp4toannexb");
    }
    return args;
  }

  if (normalized === "hevc" || normalized === "h265") {
    const args = ["-c:v", "copy"];
    if (needsAnnexBBitstream(ext)) {
      args.push("-bsf:v", "hevc_mp4toannexb");
    }
    return args;
  }

  return ["-c:v", "copy"];
}

export function startHlsRemux(
  sessionId: string,
  filePath: string,
  outputDir: string,
  segmentDuration: number,
  startSeconds = 0,
  videoCodec?: string | null,
  audioStreamIndex?: number | null,
): HlsSession {
  enforceTranscodeCapacity(sessionId);
  stopHlsSession(sessionId);
  fs.mkdirSync(outputDir, { recursive: true });
  const playlistPath = `${outputDir}/master.m3u8`;

  clearTranscodeOutput(outputDir);
  writeStartOffset(outputDir, startSeconds);

  const logPath = `${outputDir}/ffmpeg.log`;
  const logStream = fs.openSync(logPath, "a");
  let logClosed = false;
  const closeLog = () => {
    if (!logClosed) {
      logClosed = true;
      fs.closeSync(logStream);
    }
  };

  const args = ["-y"];
  if (startSeconds > 0) {
    args.push("-ss", String(startSeconds));
  }
  args.push("-i", filePath, "-map", "0:v:0", ...audioMapArgs(audioStreamIndex));
  args.push("-fflags", "+genpts", "-avoid_negative_ts", "make_zero");
  args.push(...hlsVideoCopyArgs(videoCodec, filePath));
  args.push(
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-threads",
    "0",
    "-f",
    "hls",
    "-hls_time",
    String(segmentDuration),
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "independent_segments+append_list",
    "-hls_segment_filename",
    `${outputDir}/segment_%03d.ts`,
    playlistPath,
  );

  const process = spawn("ffmpeg", args, {
    stdio: ["ignore", logStream, logStream],
  });

  const session: HlsSession = {
    id: sessionId,
    process,
    outputDir,
    playlistPath,
    lastAccess: Date.now(),
    lastServedSegmentIndex: -1,
  };

  activeSessions.set(sessionId, session);

  process.on("close", (code) => {
    closeLog();
    writeExitCode(outputDir, code);
    activeSessions.delete(sessionId);
    if (code !== 0 && code !== null) {
      console.warn(`HLS remux exited with code ${code} for session ${sessionId}`);
    }
  });

  process.on("error", (err) => {
    closeLog();
    writeExitCode(outputDir, -1);
    activeSessions.delete(sessionId);
    console.warn(`HLS remux failed for session ${sessionId}:`, err.message);
  });

  return session;
}

export function resolveHlsSession(
  sessionId: string,
  outputDir: string,
  startSeconds = 0,
): HlsSession | undefined {
  const active = getHlsSession(sessionId);
  if (active) {
    const storedOffset = readStartOffset(active.outputDir);
    if (Math.abs(storedOffset - startSeconds) <= 5) return active;
    return undefined;
  }

  if (listHlsSegments(outputDir).length === 0) return undefined;
  if (Math.abs(readStartOffset(outputDir) - startSeconds) > 5) return undefined;

  return {
    id: sessionId,
    process: null,
    outputDir,
    playlistPath: path.join(outputDir, "master.m3u8"),
    lastAccess: Date.now(),
    lastServedSegmentIndex: -1,
  };
}

export function listHlsSegments(outputDir: string): string[] {
  if (!fs.existsSync(outputDir)) return [];

  return fs
    .readdirSync(outputDir)
    .filter((name) => /^segment_\d+\.ts$/.test(name))
    .sort((a, b) => {
      const ai = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const bi = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return ai - bi;
    });
}

function hasCompleteHlsPlaylist(outputDir: string): boolean {
  const playlistPath = path.join(outputDir, "master.m3u8");
  if (!fs.existsSync(playlistPath)) return false;

  try {
    const stat = fs.statSync(playlistPath);
    if (stat.size === 0) return false;
    const content = fs.readFileSync(playlistPath, "utf-8");
    return content.includes("#EXTINF") && content.includes("#EXT-X-ENDLIST");
  } catch {
    return false;
  }
}

export function parseHlsSegmentIndex(segmentName: string): number {
  return parseInt(segmentName.match(/\d+/)?.[0] ?? "0", 10);
}

/**
 * Delete segments strictly older than `minSegmentIndex`. FFmpeg has no
 * realtime throttle (`-re`) and can encode many minutes ahead of actual
 * playback, so the caller must derive `minSegmentIndex` from what the client
 * has consumed — never from segment count alone, or this can delete data the
 * client hasn't requested yet and force a forward skip.
 */
export function pruneOldHlsSegments(
  outputDir: string,
  minSegmentIndex: number,
): void {
  if (minSegmentIndex <= 0) return;

  for (const segment of listHlsSegments(outputDir)) {
    if (parseHlsSegmentIndex(segment) >= minSegmentIndex) break;
    try {
      fs.unlinkSync(path.join(outputDir, segment));
    } catch {
      // segment may already be removed
    }
  }
}

/** One media segment parsed from ffmpeg's playlist, with its own tags. */
interface ParsedHlsSegment {
  index: number;
  uri: string;
  /** Tag lines (#EXTINF, #EXT-X-DISCONTINUITY, etc.) that precede this URI. */
  tags: string[];
}

interface ParsedHlsPlaylist {
  /** Header tags before the first segment (VERSION, TARGETDURATION, ...). */
  header: string[];
  segments: ParsedHlsSegment[];
  hasEndList: boolean;
}

/** Sum of `#EXTINF` durations across the given segments (seconds). */
export function sumPlaylistDurationSeconds(
  segments: ParsedHlsSegment[],
): number {
  let total = 0;
  for (const seg of segments) {
    for (const tag of seg.tags) {
      if (tag.startsWith("#EXTINF")) {
        const value = parseFloat(tag.slice("#EXTINF:".length));
        if (Number.isFinite(value)) total += value;
      }
    }
  }
  return total;
}

/**
 * Parse ffmpeg's own master.m3u8. Modern ffmpeg (5.x+) writes this file
 * incrementally with ACCURATE per-segment `#EXTINF` durations, the correct
 * `#EXT-X-TARGETDURATION`, discontinuities, and appends `#EXT-X-ENDLIST` on
 * completion. Serving it verbatim (only rewriting segment URIs) is far more
 * robust than synthesizing a playlist with assumed 6.0s durations — a
 * duration mismatch breaks hls.js buffer/live-edge math and stalls playback.
 */
export function parseFfmpegPlaylist(m3u8: string): ParsedHlsPlaylist | null {
  const rawLines = m3u8.split(/\r?\n/);
  const header: string[] = [];
  const segments: ParsedHlsSegment[] = [];
  let pendingTags: string[] = [];
  let hasEndList = false;
  let seenFirstSegment = false;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    if (trimmed === "#EXT-X-ENDLIST") {
      hasEndList = true;
      continue;
    }

    if (trimmed.startsWith("#")) {
      // Header-only tags stay in the header; per-segment tags (EXTINF,
      // DISCONTINUITY, PROGRAM-DATE-TIME, BYTERANGE, KEY, MAP) attach to the
      // next segment URI.
      const isSegmentScopedTag =
        trimmed.startsWith("#EXTINF") ||
        trimmed.startsWith("#EXT-X-DISCONTINUITY") ||
        trimmed.startsWith("#EXT-X-PROGRAM-DATE-TIME") ||
        trimmed.startsWith("#EXT-X-BYTERANGE") ||
        trimmed.startsWith("#EXT-X-KEY") ||
        trimmed.startsWith("#EXT-X-MAP");

      if (isSegmentScopedTag) {
        pendingTags.push(trimmed);
      } else if (!seenFirstSegment) {
        header.push(trimmed);
      }
      continue;
    }

    // A media segment URI.
    const match = trimmed.match(/segment_(\d+)\.ts/);
    if (!match) {
      // Unknown URI form — skip its pending tags to stay consistent.
      pendingTags = [];
      continue;
    }
    seenFirstSegment = true;
    segments.push({
      index: parseInt(match[1], 10),
      uri: trimmed,
      tags: pendingTags,
    });
    pendingTags = [];
  }

  if (!header.some((line) => line === "#EXTM3U")) {
    // ffmpeg always writes #EXTM3U first; its absence means the file is being
    // written and we caught it mid-flush.
    return null;
  }

  return { header, segments, hasEndList };
}

/**
 * Build the media playlist served to the client from ffmpeg's real playlist.
 *
 * - Preserves ffmpeg's accurate per-segment durations and header tags.
 * - Applies consumption-based windowing/pruning (same policy as before).
 * - Only emits `#EXT-X-ENDLIST` when ffmpeg did AND the process is done, so a
 *   still-growing session is never prematurely marked complete.
 * - Keeps `#EXT-X-PLAYLIST-TYPE:EVENT` while in progress so hls.js treats it
 *   as a growing (reloadable) playlist.
 */
export function generateHlsPlaylist(
  outputDir: string,
  segmentDuration: number,
  inProgress: boolean,
  lastServedSegmentIndex = -1,
  sourceDurationSeconds = 0,
): string | null {
  const playlistPath = path.join(outputDir, "master.m3u8");
  let raw: string;
  try {
    raw = fs.readFileSync(playlistPath, "utf-8");
  } catch {
    return null;
  }

  const parsed = parseFfmpegPlaylist(raw);
  if (!parsed) return null;

  // Only keep segments whose files actually exist on disk with content — the
  // playlist can reference a segment ffmpeg has announced but not fully
  // flushed yet.
  const existing = parsed.segments.filter((seg) => {
    try {
      return fs.statSync(path.join(outputDir, seg.uri)).size > 0;
    } catch {
      return false;
    }
  });

  if (existing.length === 0) return null;

  // Trail the retention window behind the client's own consumption point, not
  // behind the newest segment written — the encoder can race ahead of
  // playback, so windowing off segment count alone can prune or hide segments
  // the client hasn't reached yet.
  const minSegmentIndex = Math.max(
    0,
    lastServedSegmentIndex - HLS_PLAYLIST_WINDOW_SEGMENTS,
  );

  if (inProgress && minSegmentIndex > 0) {
    pruneOldHlsSegments(outputDir, minSegmentIndex);
  }

  const windowed =
    minSegmentIndex > 0
      ? existing.filter((seg) => seg.index >= minSegmentIndex)
      : existing;

  if (windowed.length === 0) return null;

  // Rebuild the header, guaranteeing the tags hls.js needs and dropping any
  // ENDLIST that ffmpeg wrote (we re-add it below only when truly complete).
  const targetDurationLine = parsed.header.find((line) =>
    line.startsWith("#EXT-X-TARGETDURATION"),
  );
  const versionLine =
    parsed.header.find((line) => line.startsWith("#EXT-X-VERSION")) ??
    "#EXT-X-VERSION:6";
  const independentLine = parsed.header.find(
    (line) => line === "#EXT-X-INDEPENDENT-SEGMENTS",
  );

  const targetDuration = targetDurationLine
    ? targetDurationLine
    : `#EXT-X-TARGETDURATION:${Math.max(segmentDuration, 1)}`;

  const lines: string[] = [
    "#EXTM3U",
    versionLine,
    targetDuration,
    `#EXT-X-MEDIA-SEQUENCE:${windowed[0].index}`,
  ];

  if (independentLine) {
    lines.push(independentLine);
  }

  if (inProgress) {
    lines.push("#EXT-X-PLAYLIST-TYPE:EVENT");
  } else {
    lines.push("#EXT-X-PLAYLIST-TYPE:VOD");
  }

  for (const seg of windowed) {
    // Drop a leading DISCONTINUITY on the very first windowed segment — it is
    // only meaningful relative to a prior segment that is no longer present.
    const tags =
      seg === windowed[0]
        ? seg.tags.filter((tag) => tag !== "#EXT-X-DISCONTINUITY")
        : seg.tags;
    for (const tag of tags) {
      lines.push(tag);
    }
    lines.push(seg.uri);
  }

  // Emit #EXT-X-ENDLIST ONLY when we are certain the transcode reached the
  // true end of the source. ffmpeg writes ENDLIST into its own playlist even
  // when it is SIGTERM'd mid-encode (verified), which would otherwise make a
  // 20-second partial transcode look like the whole movie and freeze the
  // client at that point forever. Defense in depth:
  //   1. The session must no longer be in progress.
  //   2. ffmpeg must have written ENDLIST.
  //   3. The process must have exited cleanly (exit code 0).
  //   4. The produced playlist must actually cover the source duration
  //      (within one segment) when we know the source duration — a killed
  //      transcode fails this even if it somehow reports a clean exit.
  // Total media ffmpeg has actually produced (all segments, including any
  // pruned from the served window). The HLS timeline is relative to the
  // session's `-ss` start, so compare against the *remaining* source length.
  const producedDurationSeconds = sumPlaylistDurationSeconds(parsed.segments);
  const startOffsetSeconds = readStartOffset(outputDir);
  const remainingSourceSeconds = Math.max(0, sourceDurationSeconds - startOffsetSeconds);
  const coversSource =
    remainingSourceSeconds <= 0 ||
    producedDurationSeconds >= remainingSourceSeconds - Math.max(segmentDuration, 6);

  if (
    !inProgress &&
    parsed.hasEndList &&
    isTranscodeOutputComplete(outputDir) &&
    coversSource
  ) {
    lines.push("#EXT-X-ENDLIST");
  }

  return `${lines.join("\n")}\n`;
}

export function isTranscodeInProgress(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

export function getHlsSession(sessionId: string): HlsSession | undefined {
  const session = activeSessions.get(sessionId);
  if (session) session.lastAccess = Date.now();
  return session;
}

export function stopHlsSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  try {
    session.process?.kill("SIGTERM");
  } catch {
    // already exited
  }
  activeSessions.delete(sessionId);
  killFfmpegInDir(session.outputDir);
  try {
    removeTranscodeDir(session.outputDir);
  } catch (err) {
    // Must never throw — caller is inside request handling / cleanup timers.
    console.warn(`Failed to remove transcode dir ${session.outputDir}:`, err);
  }
}

/** Stop every tracked HLS encoder during an orderly server shutdown. */
export function stopAllHlsSessions(): void {
  for (const sessionId of [...activeSessions.keys()]) {
    stopHlsSession(sessionId);
  }
}

export function stopTranscodeSessionsForMedia(
  cacheDir: string,
  sessionPrefix: string,
  keepSessionId?: string,
): void {
  if (!fs.existsSync(cacheDir)) return;

  const now = Date.now();
  for (const entry of fs.readdirSync(cacheDir)) {
    if (!entry.startsWith(sessionPrefix)) continue;
    if (entry === keepSessionId) continue;
    // Never kill a session another request is actively pulling from — only
    // reap genuinely stale sessions. This runs on every playlist poll, so
    // killing an in-use session here is what freezes playback mid-movie.
    const active = activeSessions.get(entry);
    if (active && now - active.lastAccess <= ACTIVELY_SERVING_MS) continue;
    stopHlsSession(entry);
  }
}

export function stopTranscodeSessionsForFile(
  cacheDir: string,
  type: "movie" | "episode",
  fileId: number,
  keepSessionId?: string,
): void {
  stopTranscodeSessionsForMedia(
    cacheDir,
    createStreamFilePrefix(type, fileId),
    keepSessionId,
  );
}

export function enforceTranscodeCapacity(keepSessionId?: string): void {
  if (activeSessions.size < MAX_CONCURRENT_TRANSCODES) return;

  const now = Date.now();
  const sessions = [...activeSessions.entries()]
    .filter(([id]) => id !== keepSessionId)
    // Never evict a session a client is actively pulling from.
    .filter(([, s]) => now - s.lastAccess > ACTIVELY_SERVING_MS)
    .sort(([, a], [, b]) => a.lastAccess - b.lastAccess);

  for (const [id] of sessions) {
    stopHlsSession(id);
    if (activeSessions.size < MAX_CONCURRENT_TRANSCODES) break;
  }
}

export function killOrphanFfmpegInCache(cacheDir: string): number {
  if (!fs.existsSync(cacheDir)) return 0;

  const trackedDirs = new Set(
    [...activeSessions.values()].map((session) => session.outputDir),
  );
  let killed = 0;

  try {
    const stdout = execSync("pgrep -af ffmpeg || true", { encoding: "utf8" });
    for (const line of stdout.split("\n")) {
      if (!line.includes(cacheDir)) continue;
      const pid = parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
      if (!Number.isFinite(pid) || pid <= 0) continue;

      const dirMatch = line.match(
        new RegExp(`${cacheDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/\\s]+)`),
      );
      const sessionDir = dirMatch
        ? path.join(cacheDir, dirMatch[1])
        : null;
      if (sessionDir && trackedDirs.has(sessionDir)) continue;

      try {
        process.kill(pid, "SIGTERM");
        killed++;
      } catch {
        // process already exited
      }
    }
  } catch {
    // pgrep unavailable
  }

  return killed;
}

export function cleanupIdleSessions(maxIdleMs = IDLE_SESSION_MS): void {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now - session.lastAccess > maxIdleMs) {
      try {
        stopHlsSession(id);
      } catch (err) {
        console.warn(`Failed to stop idle transcode session ${id}:`, err);
      }
    }
  }
}

export function pruneStaleTranscodeCache(
  cacheDir: string,
  maxAgeMs = 6 * 60 * 60 * 1000,
): number {
  if (!fs.existsSync(cacheDir)) return 0;

  const activeDirs = new Set(
    [...activeSessions.values()].map((session) => session.outputDir),
  );
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const entry of fs.readdirSync(cacheDir)) {
    const outputDir = path.join(cacheDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(outputDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (activeDirs.has(outputDir)) continue;
    if (stat.mtimeMs > cutoff) continue;

    if (removeTranscodeDir(outputDir)) {
      removed++;
    }
  }

  return removed;
}

const cleanupTimer = setInterval(() => {
  try {
    cleanupIdleSessions();
  } catch (err) {
    console.warn("Idle transcode session cleanup failed:", err);
  }
}, 60_000);
cleanupTimer.unref?.();

/** Wait for ffmpeg to finish writing a segment that is not on disk yet. */
export async function waitForHlsSegment(
  outputDir: string,
  segmentName: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const segmentPath = path.join(outputDir, segmentName);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(segmentPath) && fs.statSync(segmentPath).size > 0) {
        return true;
      }
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return false;
}

export async function waitForFirstSegment(
  outputDir: string,
  timeoutMs = 90_000,
  minSegments = 2,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const segments = listHlsSegments(outputDir).filter((name) => {
      try {
        return fs.statSync(path.join(outputDir, name)).size > 0;
      } catch {
        return false;
      }
    });

    if (
      segments.length >= minSegments ||
      (segments.length > 0 && hasCompleteHlsPlaylist(outputDir))
    ) {
      return true;
    }

    const elapsed = Date.now() - start;
    await new Promise((r) => setTimeout(r, elapsed < 5000 ? 200 : 500));
  }

  return false;
}

/** @deprecated Use waitForFirstSegment — FFmpeg 4.x may not write m3u8 until complete. */
export async function waitForPlaylist(
  playlistPath: string,
  outputDir?: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  if (outputDir) {
    return waitForFirstSegment(outputDir, timeoutMs);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(playlistPath)) {
      const content = fs.readFileSync(playlistPath, "utf-8");
      if (content.includes("#EXTINF")) return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function waitForCompletePlaylist(
  playlistPath: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(playlistPath)) {
      const content = fs.readFileSync(playlistPath, "utf-8");
      if (content.includes("#EXTINF") && content.includes("#EXT-X-ENDLIST")) {
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function canDirectCast(
  filePath: string,
  probe: ProbeResult | null,
): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
  if (ext !== ".mp4" && ext !== ".m4v") return false;
  if (!probe) return false;

  const videoOk = probe.videoCodec === "h264";
  const audioOk =
    !probe.audioCodec || ["aac", "mp3"].includes(probe.audioCodec);

  return videoOk && audioOk;
}
