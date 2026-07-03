import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationMs: number;
  videoCodec?: string;
  audioCodec?: string;
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

export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
    return true;
  } catch {
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
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        tags?: { language?: string; title?: string };
      }>;
    };

    const videoStream = data.streams?.find((s) => s.codec_type === "video");
    const audioStream = data.streams?.find((s) => s.codec_type === "audio");
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
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) resolve();
      else reject(new Error(`Failed to extract subtitle stream ${streamIndex}`));
    });
    proc.on("error", reject);
  });
}

export interface HlsSession {
  id: string;
  process: ChildProcess;
  outputDir: string;
  playlistPath: string;
  lastAccess: number;
}

const activeSessions = new Map<string, HlsSession>();

export function startHlsTranscode(
  sessionId: string,
  filePath: string,
  outputDir: string,
  segmentDuration: number,
): HlsSession {
  fs.mkdirSync(outputDir, { recursive: true });
  const playlistPath = `${outputDir}/master.m3u8`;

  const args = [
    "-y",
    "-i",
    filePath,
    "-c:v",
    "libx264",
    "-profile:v",
    "main",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    String(segmentDuration),
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    `${outputDir}/segment_%03d.ts`,
    playlistPath,
  ];

  const process = spawn("ffmpeg", args, { stdio: "ignore" });

  const session: HlsSession = {
    id: sessionId,
    process,
    outputDir,
    playlistPath,
    lastAccess: Date.now(),
  };

  activeSessions.set(sessionId, session);

  process.on("close", () => {
    activeSessions.delete(sessionId);
  });

  return session;
}

export function getHlsSession(sessionId: string): HlsSession | undefined {
  const session = activeSessions.get(sessionId);
  if (session) session.lastAccess = Date.now();
  return session;
}

export function stopHlsSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.process.kill("SIGTERM");
    activeSessions.delete(sessionId);
  }
}

export function cleanupIdleSessions(maxIdleMs = 5 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now - session.lastAccess > maxIdleMs) {
      session.process.kill("SIGTERM");
      activeSessions.delete(id);
    }
  }
}

setInterval(() => cleanupIdleSessions(), 60_000);

export async function waitForPlaylist(
  playlistPath: string,
  timeoutMs = 30_000,
): Promise<boolean> {
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
