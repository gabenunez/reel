import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { DatabaseInstance } from "../db/index.js";
import type { ConfigManager } from "../config.js";
import type { SubtitleService } from "../services/subtitles.js";
import { OpenSubtitlesService } from "../services/opensubtitles.js";
import { computeOpenSubtitlesHash } from "../utils/opensubtitles-hash.js";
import {
  mediaItems,
  movieFiles,
  tvEpisodes,
  tvSeasons,
} from "../db/schema.js";
import { errorMessage } from "./util.js";

async function resolvePlaybackContext(
  db: DatabaseInstance,
  fileId: number,
  type: "movie" | "episode",
) {
  if (type === "movie") {
    const file = await db.query.movieFiles.findFirst({
      where: eq(movieFiles.id, fileId),
    });
    if (!file) return null;

    const media = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, file.mediaItemId),
    });

    return {
      filePath: file.filePath,
      movieFileId: file.id,
      title: media?.title ?? "",
      year: media?.year ?? null,
      tmdbId: media?.tmdbId ?? null,
      imdbId: media?.imdbId ?? null,
      type: "movie" as const,
    };
  }

  const episode = await db.query.tvEpisodes.findFirst({
    where: eq(tvEpisodes.id, fileId),
  });
  if (!episode) return null;

  const season = await db.query.tvSeasons.findFirst({
    where: eq(tvSeasons.id, episode.seasonId),
  });
  if (!season) return null;

  const media = await db.query.mediaItems.findFirst({
    where: eq(mediaItems.id, season.mediaItemId),
  });

  return {
    filePath: episode.filePath,
    episodeId: episode.id,
    title: media?.title ?? "",
    year: media?.year ?? null,
    tmdbId: media?.tmdbId ?? null,
    imdbId: media?.imdbId ?? null,
    seasonNumber: season.seasonNumber,
    episodeNumber: episode.episodeNumber,
    type: "episode" as const,
  };
}

function imdbIdToOpenSubtitlesNumber(imdbId: string | null | undefined): number | undefined {
  if (!imdbId) return undefined;
  const digits = imdbId.replace(/^tt/i, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function subtitleSearchRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  configManager: ConfigManager,
  subtitleService: SubtitleService,
) {
  const openSubtitles = new OpenSubtitlesService(configManager);

  app.get<{ Querystring: { fileId?: string; type?: "movie" | "episode" } }>(
    "/api/subtitles/list",
    async (request, reply) => {
      const fileId = parseInt(request.query.fileId ?? "", 10);
      const type = request.query.type ?? "movie";
      if (!fileId) {
        return reply.status(400).send({ error: "fileId is required" });
      }

      const tracks =
        type === "movie"
          ? await subtitleService.listForMovieFile(fileId)
          : await subtitleService.listForEpisode(fileId);

      return { tracks, opensubtitlesConfigured: openSubtitles.isConfigured() };
    },
  );

  app.get<{
    Querystring: {
      fileId?: string;
      type?: "movie" | "episode";
      languages?: string;
    };
  }>("/api/subtitles/search", async (request, reply) => {
    const fileId = parseInt(request.query.fileId ?? "", 10);
    const type = request.query.type ?? "movie";
    const languages = request.query.languages ?? "en";

    if (!fileId) {
      return reply.status(400).send({ error: "fileId is required" });
    }

    if (!openSubtitles.isConfigured()) {
      return reply.status(400).send({
        error: "OpenSubtitles API key is not configured — add one in Settings",
      });
    }

    const context = await resolvePlaybackContext(db, fileId, type);
    if (!context || !fs.existsSync(context.filePath)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const { hash, size } = computeOpenSubtitlesHash(context.filePath);
    const imdbId = imdbIdToOpenSubtitlesNumber(context.imdbId);
    const shared = {
      languages,
      type: context.type,
      seasonNumber: context.seasonNumber,
      episodeNumber: context.episodeNumber,
    } as const;

    // Hash and identity filters are ANDed by OpenSubtitles — a unique rip hash
    // would wipe an otherwise-correct IMDb/TMDB hit. Try hash alone first for
    // sync accuracy, then fall back to listing identity.
    let results = await openSubtitles.search({
      movieHash: hash,
      movieByteSize: size,
      ...shared,
    });

    if (results.length === 0) {
      results = await openSubtitles.search({
        query: context.title,
        tmdbId: context.tmdbId ?? undefined,
        imdbId,
        ...shared,
      });
    }

    return {
      results,
      context: {
        title: context.title,
        year: context.year,
        type: context.type,
        seasonNumber: context.seasonNumber,
        episodeNumber: context.episodeNumber,
      },
    };
  });

  app.post<{
    Body: {
      fileId: number;
      type: "movie" | "episode";
      opensubtitlesFileId: number;
      language: string;
      release: string;
    };
  }>("/api/subtitles/download", async (request, reply) => {
    const { fileId, type, opensubtitlesFileId, language, release } =
      request.body;

    if (!fileId || !opensubtitlesFileId || !language) {
      return reply.status(400).send({ error: "Invalid download request" });
    }

    if (!openSubtitles.isConfigured()) {
      return reply.status(400).send({
        error: "OpenSubtitles API key is not configured — add one in Settings",
      });
    }

    const context = await resolvePlaybackContext(db, fileId, type);
    if (!context || !fs.existsSync(context.filePath)) {
      return reply.status(404).send({ error: "File not found" });
    }

    let content: string;
    try {
      ({ content } = await openSubtitles.downloadSubtitleFile(opensubtitlesFileId));
    } catch (err) {
      const message =
        errorMessage(err, "Failed to download subtitle file");
      return reply.status(400).send({ error: message });
    }

    try {
      const track = await subtitleService.attachOpenSubtitlesDownload({
        movieFileId: context.movieFileId,
        episodeId: context.episodeId,
        opensubtitlesFileId,
        language,
        release: release || "Downloaded subtitle",
        rawContent: content,
      });

      return { success: true, track };
    } catch (err) {
      const message = errorMessage(err, "Failed to save subtitle");
      if (message.includes("no dialogue") || message.includes("persist")) {
        return reply.status(400).send({ error: message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/subtitles/:id",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (!id) return reply.status(400).send({ error: "Invalid subtitle id" });

      await subtitleService.deleteSubtitle(id);
      return { success: true };
    },
  );
}
