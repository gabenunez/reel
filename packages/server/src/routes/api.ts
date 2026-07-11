import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { eq, like, or, desc, sql, and, ne } from "drizzle-orm";
import type { AppConfig } from "@media-app/shared";
import type { DatabaseInstance } from "../db/index.js";
import type { ScannerService } from "../services/scanner.js";
import type { MetadataService } from "../services/metadata.js";
import type { ThemeService } from "../services/themes.js";
import {
  listDecksWithCounts,
  getDeckItems,
  parseDeckPaths,
  inferDeckTypes,
  countDeckItems,
} from "../services/decks.js";
import {
  addFavorite,
  isFavorite,
  listFavorites,
  listRecentFavorites,
  removeFavorite,
} from "../services/favorites.js";
import {
  listContinueWatching,
  listRecentlyAdded,
} from "../services/home-rows.js";
import { listLibrariesWithCounts, getLibraryItemCounts } from "../services/library-stats.js";
import { loadTvSeasonsWithEpisodes } from "../services/media-detail.js";
import { checkFfmpegAvailable } from "../utils/ffmpeg.js";
import { errorMessage, parsePagination } from "./util.js";
import {
  libraries,
  mediaItems,
  movieFiles,
  watchProgress,
  scanJobs,
  subtitles,
  libraryDecks,
} from "../db/schema.js";

function parseGenreSet(genres: string | null | undefined): Set<string> {
  if (!genres?.trim()) return new Set();
  return new Set(
    genres
      .split(",")
      .map((genre) => genre.trim().toLowerCase())
      .filter(Boolean),
  );
}

function genreOverlapScore(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftGenres = parseGenreSet(left);
  const rightGenres = parseGenreSet(right);
  if (!leftGenres.size || !rightGenres.size) return 0;

  let overlap = 0;
  for (const genre of leftGenres) {
    if (rightGenres.has(genre)) overlap++;
  }
  return overlap;
}

export async function apiRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  config: AppConfig,
  scanner: ScannerService,
  metadata: MetadataService,
  themes: ThemeService,
) {
  app.get("/api/status", async () => {
    const ffmpegAvailable = await checkFfmpegAvailable();
    const libraryStats = await listLibrariesWithCounts(db);

    const activeScan = scanner.getActiveScan();
    let scanInfo = null;
    if (activeScan) {
      const job = await db.query.scanJobs.findFirst({
        where: eq(scanJobs.id, activeScan.jobId),
      });
      const lib = await db.query.libraries.findFirst({
        where: eq(libraries.id, activeScan.libraryId),
      });
      if (job && lib) {
        scanInfo = {
          libraryId: lib.id,
          libraryName: lib.name,
          progress: job.progress,
          status: job.status,
          message: job.message ?? undefined,
        };
      }
    }

    return {
      ffmpegAvailable,
      tmdbConfigured: metadata.isConfigured(),
      libraries: libraryStats,
      activeScan: scanInfo,
    };
  });

  app.get<{ Querystring: { page?: string; limit?: string; type?: string } }>(
    "/api/favorites",
    async (request) => {
      const { page, limit } = parsePagination(request.query);
      const type =
        request.query.type === "movie" || request.query.type === "tv"
          ? request.query.type
          : undefined;

      return listFavorites(db, { page, limit, type });
    },
  );

  app.post<{ Body: { mediaItemId?: number } }>("/api/favorites", async (request, reply) => {
    const mediaItemId = request.body?.mediaItemId;
    if (!mediaItemId || !Number.isFinite(mediaItemId)) {
      return reply.status(400).send({ error: "mediaItemId is required" });
    }

    try {
      await addFavorite(db, mediaItemId);
      return { success: true };
    } catch (err) {
      const message = errorMessage(err, "Failed to add favorite");
      if (message === "Media item not found") {
        return reply.status(404).send({ error: message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { mediaItemId: string } }>(
    "/api/favorites/:mediaItemId",
    async (request) => {
      const mediaItemId = parseInt(request.params.mediaItemId, 10);
      await removeFavorite(db, mediaItemId);
      return { success: true };
    },
  );

  app.get("/api/decks", async () => {
    return listDecksWithCounts(db);
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/decks/:id/items",
    async (request, reply) => {
      const deckId = parseInt(request.params.id, 10);
      const { page, limit } = parsePagination(request.query);

      const deck = await db.query.libraryDecks.findFirst({
        where: eq(libraryDecks.id, deckId),
      });
      if (!deck) return reply.status(404).send({ error: "Deck not found" });

      const paths = parseDeckPaths(deck.paths);
      return getDeckItems(db, paths, page, limit);
    },
  );

  app.get<{ Params: { id: string } }>("/api/decks/:id", async (request, reply) => {
    const deckId = parseInt(request.params.id, 10);
    const deck = await db.query.libraryDecks.findFirst({
      where: eq(libraryDecks.id, deckId),
    });
    if (!deck) return reply.status(404).send({ error: "Deck not found" });

    const paths = parseDeckPaths(deck.paths);
    const allLibraries = await db.query.libraries.findMany();
    const itemCount = await countDeckItems(db, paths);

    return {
      id: deck.id,
      name: deck.name,
      paths,
      sortOrder: deck.sortOrder,
      itemCount,
      types: inferDeckTypes(paths, allLibraries),
      createdAt: deck.createdAt.toISOString(),
    };
  });

  app.get("/api/libraries", async () => {
    const allLibraries = await db.query.libraries.findMany();
    const counts = await getLibraryItemCounts(db);
    return allLibraries.map((lib) => ({
      ...lib,
      itemCount: counts.get(lib.id) ?? 0,
      lastScannedAt: lib.lastScannedAt?.toISOString() ?? null,
    }));
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/libraries/:id/items",
    async (request) => {
      const libraryId = parseInt(request.params.id, 10);
      const { page, limit } = parsePagination(request.query);
      const offset = (page - 1) * limit;

      const items = await db.query.mediaItems.findMany({
        where: eq(mediaItems.libraryId, libraryId),
        orderBy: [desc(mediaItems.updatedAt)],
        limit,
        offset,
      });

      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(mediaItems)
        .where(eq(mediaItems.libraryId, libraryId));

      return {
        items,
        page,
        limit,
        total: total[0]?.count ?? 0,
        totalPages: Math.ceil((total[0]?.count ?? 0) / limit),
      };
    },
  );

  app.get("/api/media/ids", async () => {
    const rows = await db
      .select({ id: mediaItems.id })
      .from(mediaItems)
      .orderBy(desc(mediaItems.updatedAt));
    return { ids: rows.map((row) => row.id) };
  });

  app.get<{ Params: { id: string } }>("/api/media/:id/theme", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const item = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, id),
    });

    if (!item) {
      return reply.status(404).send({ error: "Not found" });
    }

    let themePath =
      item.themePath && fs.existsSync(item.themePath)
        ? item.themePath
        : await themes.syncForMediaItem(item);

    if (!themePath || !fs.existsSync(themePath)) {
      return reply.status(404).send({ error: "No theme music available" });
    }

    return reply
      .type(themes.mimeTypeForPath(themePath))
      .send(fs.createReadStream(themePath));
  });

  app.get<{ Params: { id: string } }>("/api/media/:id", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const item = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, id),
    });

    if (!item) return reply.status(404).send({ error: "Not found" });

    const themePath = themes.hasThemeMusic(item) ? item.themePath : null;
    if (!themePath) {
      void themes.syncForMediaItem(item);
    }
    const hasThemeMusic = Boolean(themePath && fs.existsSync(themePath));
    const favorite = await isFavorite(db, id);

    if (item.type === "movie") {
      const files = await db.query.movieFiles.findMany({
        where: eq(movieFiles.mediaItemId, id),
      });
      const subs = files.length
        ? await db.query.subtitles.findMany({
            where: eq(subtitles.movieFileId, files[0].id),
          })
        : [];

      const progress = await db.query.watchProgress.findFirst({
        where: and(
          eq(watchProgress.itemType, "movie"),
          eq(watchProgress.itemId, files[0]?.id ?? 0),
        ),
      });

      return {
        ...item,
        files,
        subtitles: subs,
        watchProgress: progress ?? null,
        isFavorite: favorite,
        hasThemeMusic,
      };
    }

    const seasonsWithEpisodes = await loadTvSeasonsWithEpisodes(db, id);

    return { ...item, seasons: seasonsWithEpisodes, isFavorite: favorite, hasThemeMusic };
  });

  app.get<{ Params: { id: string } }>("/api/media/:id/related", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const item = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, id),
    });

    if (!item) {
      return reply.status(404).send({ error: "Not found" });
    }

    const candidates = await db.query.mediaItems.findMany({
      where: and(
        eq(mediaItems.libraryId, item.libraryId),
        eq(mediaItems.type, item.type),
        ne(mediaItems.id, id),
      ),
      orderBy: [desc(mediaItems.rating)],
      limit: 80,
    });

    const items = candidates
      .map((candidate) => ({
        candidate,
        score: genreOverlapScore(item.genres, candidate.genres),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.candidate.rating ?? 0) - (a.candidate.rating ?? 0);
      })
      .slice(0, 12)
      .map(({ candidate }) => candidate);

    return { items };
  });

  app.get<{ Querystring: { q?: string } }>("/api/search", async (request) => {
    const q = request.query.q?.trim();
    if (!q) return { results: [] };

    const results = await db.query.mediaItems.findMany({
      where: or(
        like(mediaItems.title, `%${q}%`),
        like(mediaItems.overview, `%${q}%`),
      ),
      limit: 24,
    });

    return { results };
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>(
    "/api/continue-watching",
    async (request) => {
      const { page, limit } = parsePagination(request.query);
      return listContinueWatching(db, { page, limit });
    },
  );

  app.get<{ Querystring: { page?: string; limit?: string } }>(
    "/api/recent",
    async (request) => {
      const { page, limit } = parsePagination(request.query);
      return listRecentlyAdded(db, { page, limit });
    },
  );

  app.get("/api/home", async () => {
    const [{ items: continueItems }, { items: recent }] = await Promise.all([
      listContinueWatching(db, { page: 1, limit: 12 }),
      listRecentlyAdded(db, { page: 1, limit: 12 }),
    ]);

    const librariesWithCounts = await listLibrariesWithCounts(db);
    const decks = await listDecksWithCounts(db);
    const favoritesList = await listRecentFavorites(db, 12);
    const latestContinue = continueItems[0] ?? null;
    const recentPlay = latestContinue
      ? {
          type: latestContinue.itemType,
          fileId: latestContinue.itemId,
          mediaId: latestContinue.mediaId,
        }
      : null;

    return {
      continueWatching: continueItems,
      recentlyAdded: recent,
      favorites: favoritesList,
      libraries: librariesWithCounts,
      decks,
      tmdbConfigured: metadata.isConfigured(),
      recentPlay,
    };
  });

  app.post<{ Params: { id: string } }>(
    "/api/libraries/:id/scan",
    async (request, reply) => {
      const libraryId = parseInt(request.params.id, 10);
      const lib = await db.query.libraries.findFirst({
        where: eq(libraries.id, libraryId),
      });
      if (!lib) {
        return reply.status(404).send({ error: "Library not found" });
      }
      scanner.scheduleScan(libraryId);
      return { success: true, message: "Scan started" };
    },
  );

  app.post<{
    Body: {
      itemType: "movie" | "episode";
      itemId: number;
      positionMs: number;
      durationMs?: number;
    };
  }>("/api/watch-progress", async (request) => {
    const { itemType, itemId, positionMs, durationMs } = request.body;

    const existing = await db.query.watchProgress.findFirst({
      where: and(
        eq(watchProgress.itemType, itemType),
        eq(watchProgress.itemId, itemId),
      ),
    });

    if (existing) {
      await db
        .update(watchProgress)
        .set({ positionMs, durationMs, updatedAt: new Date() })
        .where(eq(watchProgress.id, existing.id));
      return { success: true, id: existing.id };
    }

    const [row] = await db
      .insert(watchProgress)
      .values({ itemType, itemId, positionMs, durationMs })
      .returning();

    return { success: true, id: row.id };
  });

  app.get<{ Params: { filename: string }; Querystring: { hd?: string } }>(
    "/api/images/:filename",
    async (request, reply) => {
      let { filename } = request.params;
      if (request.query.hd === "1") {
        filename = await metadata.resolveHdImageFilename(filename);
      }
      const imagePath = path.join(config.data_dir, "cache", "images", filename);

      if (!fs.existsSync(imagePath)) {
        return reply.status(404).send({ error: "Image not found" });
      }

      const ext = path.extname(filename);
      reply.header("Content-Type", mimeLookup(ext) || "image/jpeg");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(fs.createReadStream(imagePath));
    },
  );
}

function mimeLookup(ext: string): string | false {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  return map[ext.toLowerCase()] ?? false;
}
