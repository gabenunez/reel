import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { eq, like, or, desc, sql, and, ne } from "drizzle-orm";
import type { AppConfig } from "@reel/shared";
import type { DatabaseInstance } from "../db/index.js";
import type { ScannerService } from "../services/scanner.js";
import type { MetadataService } from "../services/metadata.js";
import {
  listDecksWithCounts,
  getDeckItems,
  parseDeckPaths,
  inferDeckTypes,
  countDeckItems,
} from "../services/decks.js";
import { checkFfmpegAvailable } from "../utils/ffmpeg.js";
import {
  libraries,
  mediaItems,
  tvSeasons,
  tvEpisodes,
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
) {
  app.get("/api/status", async () => {
    const ffmpegAvailable = await checkFfmpegAvailable();
    const allLibraries = await db.query.libraries.findMany();

    const libraryStats = await Promise.all(
      allLibraries.map(async (lib) => {
        const count = await db
          .select({ count: sql<number>`count(*)` })
          .from(mediaItems)
          .where(eq(mediaItems.libraryId, lib.id));
        return {
          id: lib.id,
          name: lib.name,
          type: lib.type,
          path: lib.path,
          itemCount: count[0]?.count ?? 0,
          lastScannedAt: lib.lastScannedAt?.toISOString() ?? null,
        };
      }),
    );

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

  app.get("/api/decks", async () => {
    return listDecksWithCounts(db);
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/decks/:id/items",
    async (request, reply) => {
      const deckId = parseInt(request.params.id, 10);
      const page = parseInt(request.query.page ?? "1", 10);
      const limit = parseInt(request.query.limit ?? "48", 10);

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
    return Promise.all(
      allLibraries.map(async (lib) => {
        const count = await db
          .select({ count: sql<number>`count(*)` })
          .from(mediaItems)
          .where(eq(mediaItems.libraryId, lib.id));
        return {
          ...lib,
          itemCount: count[0]?.count ?? 0,
          lastScannedAt: lib.lastScannedAt?.toISOString() ?? null,
        };
      }),
    );
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/libraries/:id/items",
    async (request) => {
      const libraryId = parseInt(request.params.id, 10);
      const page = parseInt(request.query.page ?? "1", 10);
      const limit = parseInt(request.query.limit ?? "48", 10);
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

  app.get<{ Params: { id: string } }>("/api/media/:id", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const item = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, id),
    });

    if (!item) return reply.status(404).send({ error: "Not found" });

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

      return { ...item, files, subtitles: subs, watchProgress: progress ?? null };
    }

    const seasons = await db.query.tvSeasons.findMany({
      where: eq(tvSeasons.mediaItemId, id),
      orderBy: [tvSeasons.seasonNumber],
    });

    const seasonsWithEpisodes = await Promise.all(
      seasons.map(async (season) => {
        const episodes = await db.query.tvEpisodes.findMany({
          where: eq(tvEpisodes.seasonId, season.id),
          orderBy: [tvEpisodes.episodeNumber],
        });

        const episodesWithProgress = await Promise.all(
          episodes.map(async (ep) => {
            const progress = await db.query.watchProgress.findFirst({
              where: and(
                eq(watchProgress.itemType, "episode"),
                eq(watchProgress.itemId, ep.id),
              ),
            });
            const subs = await db.query.subtitles.findMany({
              where: eq(subtitles.episodeId, ep.id),
            });
            return { ...ep, watchProgress: progress ?? null, subtitles: subs };
          }),
        );

        return { ...season, episodes: episodesWithProgress };
      }),
    );

    return { ...item, seasons: seasonsWithEpisodes };
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

  app.get("/api/home", async () => {
    const recent = await db.query.mediaItems.findMany({
      orderBy: [desc(mediaItems.createdAt)],
      limit: 12,
    });

    const progressItems = await db.query.watchProgress.findMany({
      orderBy: [desc(watchProgress.updatedAt)],
      limit: 12,
    });

    const continueWatching = await Promise.all(
      progressItems.map(async (p) => {
        if (p.itemType === "movie") {
          const file = await db.query.movieFiles.findFirst({
            where: eq(movieFiles.id, p.itemId),
          });
          if (!file) return null;
          const media = await db.query.mediaItems.findFirst({
            where: eq(mediaItems.id, file.mediaItemId),
          });
          if (!media) return null;
          const duration = p.durationMs ?? file.durationMs ?? 1;
          return {
            id: p.id,
            itemType: "movie" as const,
            itemId: file.id,
            mediaId: media.id,
            title: media.title,
            posterPath: media.posterPath,
            positionMs: p.positionMs,
            durationMs: duration,
            percent: Math.min(100, (p.positionMs / duration) * 100),
          };
        }

        const episode = await db.query.tvEpisodes.findFirst({
          where: eq(tvEpisodes.id, p.itemId),
        });
        if (!episode) return null;
        const season = await db.query.tvSeasons.findFirst({
          where: eq(tvSeasons.id, episode.seasonId),
        });
        if (!season) return null;
        const media = await db.query.mediaItems.findFirst({
          where: eq(mediaItems.id, season.mediaItemId),
        });
        if (!media) return null;
        const duration = p.durationMs ?? episode.durationMs ?? 1;

        return {
          id: p.id,
          itemType: "episode" as const,
          itemId: episode.id,
          mediaId: media.id,
          title: media.title,
          subtitle: `S${season.seasonNumber}E${episode.episodeNumber} · ${episode.title}`,
          posterPath: episode.stillPath ?? media.posterPath,
          positionMs: p.positionMs,
          durationMs: duration,
          percent: Math.min(100, (p.positionMs / duration) * 100),
        };
      }),
    );

    const librariesList = await db.query.libraries.findMany();
    const librariesWithCounts = await Promise.all(
      librariesList.map(async (lib) => {
        const count = await db
          .select({ count: sql<number>`count(*)` })
          .from(mediaItems)
          .where(eq(mediaItems.libraryId, lib.id));
        return {
          id: lib.id,
          name: lib.name,
          type: lib.type,
          path: lib.path,
          itemCount: count[0]?.count ?? 0,
          lastScannedAt: lib.lastScannedAt?.toISOString() ?? null,
        };
      }),
    );
    const decks = await listDecksWithCounts(db);
    const continueItems = continueWatching.filter(
      (item): item is NonNullable<(typeof continueWatching)[number]> => item != null,
    );
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

  app.get("/api/images/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const imagePath = path.join(config.data_dir, "cache", "images", filename);

    if (!fs.existsSync(imagePath)) {
      return reply.status(404).send({ error: "Image not found" });
    }

    const ext = path.extname(filename);
    reply.header("Content-Type", mimeLookup(ext) || "image/jpeg");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(fs.createReadStream(imagePath));
  });
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
