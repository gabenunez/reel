import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import mime from "mime-types";
import crypto from "node:crypto";
import type { AppConfig } from "@reel/shared";
import type { DatabaseInstance } from "../db/index.js";
import type { ScannerService } from "../services/scanner.js";
import type { SubtitleService } from "../services/subtitles.js";
import { movieFiles, tvEpisodes, subtitles } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  startHlsTranscode,
  getHlsSession,
  waitForPlaylist,
} from "../utils/ffmpeg.js";
import { getCastBaseUrl, toAbsoluteUrl } from "../utils/network.js";

interface StreamParams {
  fileId: string;
}

interface StreamQuery {
  type?: "movie" | "episode";
  transcode?: string;
  cast?: string;
  base?: string;
}

export async function streamRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  config: AppConfig,
) {
  async function resolveFile(
    fileId: number,
    type: "movie" | "episode",
  ): Promise<{ filePath: string; id: number } | null> {
    if (type === "movie") {
      const file = await db.query.movieFiles.findFirst({
        where: eq(movieFiles.id, fileId),
      });
      return file ? { filePath: file.filePath, id: file.id } : null;
    }

    const episode = await db.query.tvEpisodes.findFirst({
      where: eq(tvEpisodes.id, fileId),
    });
    return episode ? { filePath: episode.filePath, id: episode.id } : null;
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
      const ext = path.extname(file.filePath);
      const mimeType = mime.lookup(ext) || "application/octet-stream";

      return {
        id: file.id,
        type,
        mimeType,
        fileSize: stats.size,
        fileName: path.basename(file.filePath),
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
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const sessionId = crypto
        .createHash("md5")
        .update(`${type}:${fileId}`)
        .digest("hex");

      let session = getHlsSession(sessionId);

      if (!session) {
        const outputDir = path.join(
          config.transcoding.cache_dir,
          sessionId,
        );
        session = startHlsTranscode(
          sessionId,
          file.filePath,
          outputDir,
          config.transcoding.hls_segment_duration,
        );

        const ready = await waitForPlaylist(session.playlistPath);
        if (!ready) {
          return reply.status(500).send({ error: "Transcoding failed to start" });
        }
      }

      const playlist = fs.readFileSync(session.playlistPath, "utf-8");
      const useAbsolute = request.query.cast === "1";
      const baseUrl = useAbsolute
        ? (request.query.base
            ? decodeURIComponent(request.query.base)
            : getCastBaseUrl(request, config))
        : "";

      const rewritten = playlist.replace(
        /segment_\d+\.ts/g,
        (match) => {
          const segmentPath = `/api/stream/${fileId}/hls/${match}?type=${type}`;
          return useAbsolute ? toAbsoluteUrl(baseUrl, segmentPath) : segmentPath;
        },
      );

      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      reply.header("Access-Control-Allow-Origin", "*");
      return rewritten;
    },
  );

  app.get<{ Params: { fileId: string; segment: string }; Querystring: StreamQuery }>(
    "/api/stream/:fileId/hls/:segment",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const sessionId = crypto
        .createHash("md5")
        .update(`${type}:${fileId}`)
        .digest("hex");

      const session = getHlsSession(sessionId);
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
