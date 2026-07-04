import { execFile, execSync, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { HlsQuality, TranscodeQuality } from "@media-app/shared";
import {
  TRANSCODE_PRESETS,
  effectiveTranscodeHeight,
} from "@media-app/shared";
import { createStreamFilePrefix } from "./stream-session.js";

const execFileAsync = promisify(execFile);
const MAX_CONCURRENT_TRANSCODES = 2;
const IDLE_SESSION_MS = 2 * 60 * 1000;
const PRUNE_CACHE_MS = 60 * 60 * 1000;
const FFMPEG_CACHE_MS = 5 * 60 * 1000;
let ffmpegAvailabilityCache: { available: boolean; checkedAt: number } | null = null;
/** Max segments kept on disk and in the live playlist (~12 min at 6s segments). */
export const HLS_PLAYLIST_WINDOW_SEGMENTS = 120;

export interface ProbeResult {
  durationMs: number;
  videoCodec?: string;
  audioCodec?: string;
  audioStreamIndex?: number;
  width?: number;
  height?: number;
  bitrate?: number;
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
  disposition?: { default?: number; original?: number };
  tags?: { language?: string; title?: string };
};

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
      width: videoStream?.width,
      height: videoStream?.height,
      bitrate: data.format?.bit_rate
        ? parseInt(data.format.bit_rate, 10)
        : undefined,
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

export function clearTranscodeOutput(outputDir: string): void {
  if (!fs.existsSync(outputDir)) return;
  for (const entry of fs.readdirSync(outputDir)) {
    fs.unlinkSync(path.join(outputDir, entry));
  }
}

function sleepMs(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Allow FFmpeg to release file handles before retrying removal.
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
        // retry outer loop
      }
    }
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
  args.push(
    "-i",
    filePath,
    "-map",
    "0:v:0",
    ...audioMapArgs(audioStreamIndex),
    "-fflags",
    "+genpts",
    "-vf",
    `scale=-2:${height}`,
    "-c:v",
    "libx264",
    "-profile:v",
    "main",
    "-level",
    preset.h264Level,
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-threads",
    "0",
    "-crf",
    String(preset.crf),
    "-maxrate",
    preset.maxrate,
    "-bufsize",
    preset.bufsize,
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
  };

  activeSessions.set(sessionId, session);

  process.on("close", (code) => {
    closeLog();
    activeSessions.delete(sessionId);
    if (code !== 0 && code !== null) {
      console.warn(`HLS transcode exited with code ${code} for session ${sessionId}`);
    }
  });

  process.on("error", (err) => {
    closeLog();
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
  };

  activeSessions.set(sessionId, session);

  process.on("close", (code) => {
    closeLog();
    activeSessions.delete(sessionId);
    if (code !== 0 && code !== null) {
      console.warn(`HLS remux exited with code ${code} for session ${sessionId}`);
    }
  });

  process.on("error", (err) => {
    closeLog();
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

export function pruneOldHlsSegments(
  outputDir: string,
  keepCount = HLS_PLAYLIST_WINDOW_SEGMENTS,
): void {
  const segments = listHlsSegments(outputDir);
  if (segments.length <= keepCount) return;

  for (const segment of segments.slice(0, segments.length - keepCount)) {
    try {
      fs.unlinkSync(path.join(outputDir, segment));
    } catch {
      // segment may already be removed
    }
  }
}

export function generateHlsPlaylist(
  outputDir: string,
  segmentDuration: number,
  inProgress: boolean,
): string | null {
  const allSegments = listHlsSegments(outputDir).filter((name) => {
    try {
      return fs.statSync(path.join(outputDir, name)).size > 0;
    } catch {
      return false;
    }
  });

  if (allSegments.length === 0) return null;

  if (inProgress && allSegments.length > HLS_PLAYLIST_WINDOW_SEGMENTS) {
    pruneOldHlsSegments(outputDir, HLS_PLAYLIST_WINDOW_SEGMENTS);
  }

  const segments =
    allSegments.length > HLS_PLAYLIST_WINDOW_SEGMENTS
      ? allSegments.slice(-HLS_PLAYLIST_WINDOW_SEGMENTS)
      : allSegments;

  const mediaSequence = parseInt(segments[0]?.match(/\d+/)?.[0] ?? "0", 10);
  const targetDuration = Math.max(segmentDuration + 1, 6);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    "#EXT-X-PLAYLIST-TYPE:EVENT",
  ];

  for (const segment of segments) {
    lines.push(`#EXTINF:${segmentDuration}.0,`, segment);
  }

  if (!inProgress) {
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
  session.process?.kill("SIGTERM");
  activeSessions.delete(sessionId);
  killFfmpegInDir(session.outputDir);
  removeTranscodeDir(session.outputDir);
}

export function stopTranscodeSessionsForMedia(
  cacheDir: string,
  sessionPrefix: string,
  keepSessionId?: string,
): void {
  if (!fs.existsSync(cacheDir)) return;

  for (const entry of fs.readdirSync(cacheDir)) {
    if (!entry.startsWith(sessionPrefix)) continue;
    if (entry === keepSessionId) continue;
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

  const sessions = [...activeSessions.entries()]
    .filter(([id]) => id !== keepSessionId)
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

setInterval(() => {
  try {
    cleanupIdleSessions();
  } catch (err) {
    console.warn("Idle transcode session cleanup failed:", err);
  }
}, 60_000);

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

    if (segments.length >= minSegments) {
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
