import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "@reel/shared";
import type { DatabaseInstance } from "../db/index.js";
import { eq } from "drizzle-orm";
import { movieFiles, tvEpisodes } from "../db/schema.js";
import {
  startHlsTranscode,
  getHlsSession,
  waitForCompletePlaylist,
  checkFfmpegAvailable,
  probeFile,
  canDirectCast,
} from "../utils/ffmpeg.js";
import { getCastBaseUrl, toAbsoluteUrl } from "../utils/network.js";

export async function castRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  config: AppConfig,
) {
  app.get("/api/cast/config", async (request) => {
    const castBase = getCastBaseUrl(request, config);
    return {
      requestBaseUrl: castBase,
      lanBaseUrl: castBase,
      castBaseUrl: castBase,
      transcodingEnabled: config.transcoding.enabled,
    };
  });

  app.post<{
    Body: {
      fileId: number;
      type: "movie" | "episode";
      subtitleId?: number;
      title?: string;
      posterPath?: string | null;
      startTimeMs?: number;
    };
  }>("/api/cast/prepare", async (request, reply) => {
    const { fileId, type, subtitleId, title, posterPath, startTimeMs } =
      request.body;

    if (!fileId || (type !== "movie" && type !== "episode")) {
      return reply.status(400).send({ error: "Invalid cast request" });
    }

    let filePath: string | null = null;
    if (type === "movie") {
      const file = await db.query.movieFiles.findFirst({
        where: eq(movieFiles.id, fileId),
      });
      filePath = file?.filePath ?? null;
    } else {
      const episode = await db.query.tvEpisodes.findFirst({
        where: eq(tvEpisodes.id, fileId),
      });
      filePath = episode?.filePath ?? null;
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const castBase = getCastBaseUrl(request, config);
    const probe = await probeFile(filePath);

    let contentUrl: string;
    let contentType: string;

    if (canDirectCast(filePath, probe)) {
      contentUrl = toAbsoluteUrl(
        castBase,
        `/api/stream/${fileId}?type=${type}`,
      );
      contentType = "video/mp4";
    } else {
      const ffmpegAvailable = await checkFfmpegAvailable();
      if (!ffmpegAvailable || !config.transcoding.enabled) {
        return reply.status(400).send({
          error: "Chromecast requires FFmpeg transcoding for this file format",
        });
      }

      const sessionId = crypto
        .createHash("md5")
        .update(`${type}:${fileId}`)
        .digest("hex");

      let session = getHlsSession(sessionId);
      if (!session) {
        const outputDir = path.join(config.transcoding.cache_dir, sessionId);
        session = startHlsTranscode(
          sessionId,
          filePath,
          outputDir,
          config.transcoding.hls_segment_duration,
        );
      }

      const ready = await waitForCompletePlaylist(session.playlistPath);
      if (!ready) {
        return reply.status(500).send({
          error: "Transcoding is still starting — try casting again in a moment",
        });
      }

      contentUrl = toAbsoluteUrl(
        castBase,
        `/api/stream/${fileId}/hls/master.m3u8?type=${type}&cast=1&base=${encodeURIComponent(castBase)}`,
      );
      contentType = "application/vnd.apple.mpegurl";
    }

    let subtitleUrl: string | null = null;
    if (subtitleId) {
      subtitleUrl = toAbsoluteUrl(castBase, `/api/subtitles/${subtitleId}`);
    }

    let posterUrl: string | null = null;
    if (posterPath) {
      posterUrl = posterPath.startsWith("http")
        ? posterPath
        : toAbsoluteUrl(castBase, posterPath);
    }

    return {
      contentUrl,
      contentType,
      title: title ?? path.basename(filePath),
      posterUrl,
      subtitleUrl,
      startTime: startTimeMs ? startTimeMs / 1000 : 0,
      castBaseUrl: castBase,
    };
  });
}
