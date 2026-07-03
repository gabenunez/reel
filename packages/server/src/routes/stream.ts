import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import mime from "mime-types";
import type { AppConfig } from "@reel/shared";
import { getAvailableQualities, parseTranscodeQuality } from "@reel/shared";
import type { DatabaseInstance } from "../db/index.js";
import type { SubtitleService } from "../services/subtitles.js";
import { movieFiles, tvEpisodes, subtitles, watchProgress } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import {
  startHlsTranscode,
  resolveHlsSession,
  generateHlsPlaylist,
  isTranscodeInProgress,
  waitForFirstSegment,
  readStartOffset,
  clearTranscodeOutput,
  stopHlsSession,
  waitForPlaylist,
  probeFile,
} from "../utils/ffmpeg.js";
import { createStreamSessionId } from "../utils/stream-session.js";
import { getCastBaseUrl, toAbsoluteUrl } from "../utils/network.js";

interface StreamParams {
  fileId: string;
}

interface StreamQuery {
  type?: "movie" | "episode";
  transcode?: string;
  quality?: string;
  cast?: string;
  base?: string;
  start?: string;
}

function parseStartSeconds(value?: string): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export async function streamRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  config: AppConfig,
) {
  async function resolveFile(
    fileId: number,
    type: "movie" | "episode",
  ): Promise<{
    filePath: string;
    id: number;
    width?: number | null;
    height?: number | null;
    videoCodec?: string | null;
    audioCodec?: string | null;
  } | null> {
    if (type === "movie") {
      const file = await db.query.movieFiles.findFirst({
        where: eq(movieFiles.id, fileId),
      });
      return file
        ? {
            filePath: file.filePath,
            id: file.id,
            width: file.width,
            height: file.height,
            videoCodec: file.videoCodec,
            audioCodec: file.audioCodec,
          }
        : null;
    }

    const episode = await db.query.tvEpisodes.findFirst({
      where: eq(tvEpisodes.id, fileId),
    });
    return episode ? { filePath: episode.filePath, id: episode.id } : null;
  }

  async function resolveSourceHeight(
    file: { filePath: string; width?: number | null; height?: number | null },
  ): Promise<number | null> {
    if (file.height) return file.height;
    const probe = await probeFile(file.filePath);
    return probe?.height ?? null;
  }

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId/info",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const stats = fs.statSync(file.filePath);
      const lstat = fs.lstatSync(file.filePath);
      const isSymlink = lstat.isSymbolicLink();
      let symlinkTarget: string | null = null;
      if (isSymlink) {
        try {
          const link = fs.readlinkSync(file.filePath);
          symlinkTarget = path.isAbsolute(link)
            ? link
            : path.resolve(path.dirname(file.filePath), link);
        } catch {
          symlinkTarget = null;
        }
      }
      const ext = path.extname(file.filePath);
      const mimeType = mime.lookup(ext) || "application/octet-stream";
      const sourceHeight = await resolveSourceHeight(file);
      const sourceWidth = file.width ?? null;
      const probe = await probeFile(file.filePath);
      const progress = await db.query.watchProgress.findFirst({
        where: and(
          eq(watchProgress.itemType, type),
          eq(watchProgress.itemId, fileId),
        ),
      });

      return {
        id: file.id,
        type,
        mimeType,
        fileSize: stats.size,
        fileName: path.basename(file.filePath),
        filePath: file.filePath,
        isSymlink,
        symlinkTarget,
        width: sourceWidth ?? probe?.width ?? null,
        height: sourceHeight,
        durationMs: probe?.durationMs ?? null,
        videoCodec: probe?.videoCodec ?? file.videoCodec ?? null,
        audioCodec: probe?.audioCodec ?? file.audioCodec ?? null,
        bitrate: probe?.bitrate ?? null,
        availableQualities: getAvailableQualities(sourceHeight),
        transcodingEnabled: config.transcoding.enabled,
        watchProgress: progress
          ? {
              positionMs: progress.positionMs,
              durationMs: progress.durationMs,
            }
          : null,
      };
    },
  );

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const stats = fs.statSync(file.filePath);
      const ext = path.extname(file.filePath);
      const mimeType = mime.lookup(ext) || "video/mp4";
      const range = request.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunkSize = end - start + 1;

        reply
          .status(206)
          .header("Content-Range", `bytes ${start}-${end}/${stats.size}`)
          .header("Accept-Ranges", "bytes")
          .header("Content-Length", chunkSize)
          .header("Content-Type", mimeType)
          .header("Access-Control-Allow-Origin", "*");

        return reply.send(fs.createReadStream(file.filePath, { start, end }));
      }

      reply
        .header("Content-Length", stats.size)
        .header("Content-Type", mimeType)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*");

      return reply.send(fs.createReadStream(file.filePath));
    },
  );

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId/hls/master.m3u8",
    async (request, reply) => {
      if (!config.transcoding.enabled) {
        return reply.status(400).send({ error: "Transcoding disabled" });
      }

      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const quality = parseTranscodeQuality(request.query.quality) ?? "720p";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const sourceHeight = await resolveSourceHeight(file);
      const available = getAvailableQualities(sourceHeight).filter(
        (q) => q !== "original",
      );
      if (!available.includes(quality)) {
        return reply.status(400).send({
          error: `${quality} is not available for this video`,
        });
      }

      const sessionId = createStreamSessionId(type, fileId, quality);
      const outputDir = path.join(config.transcoding.cache_dir, sessionId);
      const startSeconds = parseStartSeconds(request.query.start);

      let session = resolveHlsSession(sessionId, outputDir, startSeconds);

      if (
        !session &&
        fs.existsSync(outputDir) &&
        Math.abs(readStartOffset(outputDir) - startSeconds) > 5
      ) {
        stopHlsSession(sessionId);
        clearTranscodeOutput(outputDir);
      }

      if (!session) {
        session = startHlsTranscode(
          sessionId,
          file.filePath,
          outputDir,
          config.transcoding.hls_segment_duration,
          quality,
          sourceHeight,
          startSeconds,
        );

        const ready = await waitForFirstSegment(outputDir);
        if (!ready) {
          const logPath = path.join(outputDir, "ffmpeg.log");
          const logTail = fs.existsSync(logPath)
            ? fs.readFileSync(logPath, "utf-8").slice(-2000)
            : "";
          request.log.error({ sessionId, logTail }, "Transcoding failed to start");
          return reply.status(500).send({ error: "Transcoding failed to start" });
        }
      }

      const inProgress = isTranscodeInProgress(sessionId);
      const playlist = generateHlsPlaylist(
        outputDir,
        config.transcoding.hls_segment_duration,
        inProgress,
      );

      if (!playlist) {
        return reply.status(500).send({ error: "Transcoding failed to start" });
      }

      const useAbsolute = request.query.cast === "1";
      const baseUrl = useAbsolute
        ? (request.query.base
            ? decodeURIComponent(request.query.base)
            : getCastBaseUrl(request, config))
        : "";

      const rewritten = playlist.replace(
        /segment_\d+\.ts/g,
        (match) => {
          const segmentPath = `/api/stream/${fileId}/hls/${match}?type=${type}&quality=${quality}`;
          return useAbsolute ? toAbsoluteUrl(baseUrl, segmentPath) : segmentPath;
        },
      );

      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      reply.header("Access-Control-Allow-Origin", "*");
      if (inProgress) {
        reply.header("Cache-Control", "no-store");
      }
      return rewritten;
    },
  );

  app.get<{ Params: { fileId: string; segment: string }; Querystring: StreamQuery }>(
    "/api/stream/:fileId/hls/:segment",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const quality = parseTranscodeQuality(request.query.quality) ?? "720p";
      const sessionId = createStreamSessionId(type, fileId, quality);
      const outputDir = path.join(config.transcoding.cache_dir, sessionId);
      const startSeconds = parseStartSeconds(request.query.start);

      const session = resolveHlsSession(sessionId, outputDir, startSeconds);
      if (!session) {
        return reply.status(404).send({ error: "HLS session not found" });
      }

      const segmentPath = path.join(session.outputDir, request.params.segment);
      if (!fs.existsSync(segmentPath)) {
        return reply.status(404).send({ error: "Segment not found" });
      }

      reply.header("Content-Type", "video/mp2t");
      reply.header("Access-Control-Allow-Origin", "*");
      return reply.send(fs.createReadStream(segmentPath));
    },
  );
}

export async function subtitleRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  subtitleService: SubtitleService,
) {
  app.get<{ Params: { id: string } }>(
    "/api/subtitles/:id",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const subtitle = await db.query.subtitles.findFirst({
        where: eq(subtitles.id, id),
      });

      if (!subtitle) {
        return reply.status(404).send({ error: "Subtitle not found" });
      }

      try {
        const content = await subtitleService.getSubtitleContent(subtitle);
        reply.header("Content-Type", "text/vtt");
        reply.header("Access-Control-Allow-Origin", "*");
        return content;
      } catch {
        return reply.status(500).send({ error: "Failed to read subtitle" });
      }
    },
  );
}
