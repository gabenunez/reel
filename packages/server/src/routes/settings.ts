import type { FastifyInstance } from "fastify";
import type { DatabaseInstance } from "../db/index.js";
import type { ConfigManager } from "../config.js";
import type { ScannerService } from "../services/scanner.js";
import type { MetadataService } from "../services/metadata.js";
import type { ThemeService } from "../services/themes.js";
import { getBrowseShortcuts } from "../config.js";
import { browseDirectory, validateLibraryPath } from "../utils/paths.js";
import { checkFfmpegAvailable } from "../utils/ffmpeg.js";
import { libraries } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { mediaItems } from "../db/schema.js";
import {
  createDeck,
  updateDeck,
  deleteDeck,
  listDecksWithCounts,
  resolveDeckPaths,
} from "../services/decks.js";

export async function settingsRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  configManager: ConfigManager,
  scanner: ScannerService,
  metadata: MetadataService,
  themes: ThemeService,
) {
  app.get("/api/settings", async () => {
    const config = configManager.get();
    const ffmpegAvailable = await checkFfmpegAvailable();
    const allLibraries = await db.query.libraries.findMany();

    const libraryDetails = await Promise.all(
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
          pathExists: validateLibraryPath(lib.path).valid,
        };
      }),
    );

    const key = config.metadata.tmdb_api_key?.trim() ?? "";
    const hasKey = Boolean(key && key !== "YOUR_KEY_HERE");
    const fanartKey = config.metadata.fanart_api_key?.trim() ?? "";
    const hasFanartKey = Boolean(fanartKey && fanartKey !== "YOUR_KEY_HERE");
    const osKey = config.subtitles?.opensubtitles_api_key?.trim() ?? "";
    const hasOsKey = Boolean(osKey && osKey !== "YOUR_KEY_HERE");

    return {
      ffmpegAvailable,
      libraries: libraryDetails,
      decks: await listDecksWithCounts(db),
      passwordConfigured: Boolean(config.auth?.password_hash?.trim()),
      metadata: {
        tmdbConfigured: hasKey,
        tmdbApiKeyPreview: hasKey
          ? `${key.slice(0, 4)}${"•".repeat(Math.max(0, key.length - 8))}${key.slice(-4)}`
          : "",
        fanartConfigured: hasFanartKey,
        fanartApiKeyPreview: hasFanartKey
          ? `${fanartKey.slice(0, 4)}${"•".repeat(Math.max(0, fanartKey.length - 8))}${fanartKey.slice(-4)}`
          : "",
        language: config.metadata.language,
      },
      subtitles: {
        opensubtitlesConfigured: hasOsKey,
        opensubtitlesApiKeyPreview: hasOsKey
          ? `${osKey.slice(0, 4)}${"•".repeat(Math.max(0, osKey.length - 8))}${osKey.slice(-4)}`
          : "",
      },
      browseShortcuts: getBrowseShortcuts(),
    };
  });

  app.get<{ Querystring: { path?: string } }>("/api/browse", async (request) => {
    return browseDirectory(request.query.path);
  });

  app.post<{ Body: { path?: string; libraryId?: number; scope?: "library" | "deck" } }>(
    "/api/browse/validate",
    async (request, reply) => {
      const folderPath = request.body?.path;
      if (!folderPath) {
        return reply.status(400).send({ valid: false, error: "Path is required" });
      }

      const scope = request.body?.scope ?? (request.body?.libraryId !== undefined ? "deck" : "library");

      if (scope === "deck") {
        return validateLibraryPath(folderPath);
      }

      return validateLibraryPath(folderPath);
    },
  );

  app.post<{ Body: { name: string; paths: string[]; sortOrder?: number } }>(
    "/api/decks",
    async (request, reply) => {
      const { name, paths, sortOrder } = request.body;

      if (!name?.trim()) {
        return reply.status(400).send({ error: "Deck name is required" });
      }
      if (!paths?.length) {
        return reply.status(400).send({ error: "At least one folder path is required" });
      }

      try {
        const deck = await createDeck(db, { name, paths, sortOrder });
        return {
          success: true,
          deck: {
            id: deck.id,
            name: deck.name,
            paths: JSON.parse(deck.paths) as string[],
            sortOrder: deck.sortOrder,
          },
        };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to create deck",
        });
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; paths?: string[]; sortOrder?: number };
  }>("/api/decks/:id", async (request, reply) => {
    const deckId = parseInt(request.params.id, 10);
    const { name, paths, sortOrder } = request.body;

    try {
      const deck = await updateDeck(db, deckId, { name, paths, sortOrder });
      return {
        success: true,
        deck: {
          id: deck.id,
          name: deck.name,
          paths: JSON.parse(deck.paths) as string[],
          sortOrder: deck.sortOrder,
        },
      };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to update deck",
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/decks/:id", async (request, reply) => {
    const deckId = parseInt(request.params.id, 10);
    try {
      await deleteDeck(db, deckId);
      return { success: true };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to delete deck",
      });
    }
  });

  app.post<{ Body: { paths: string[] } }>(
    "/api/decks/validate-paths",
    async (request, reply) => {
      const result = await resolveDeckPaths(db, request.body?.paths ?? []);
      if (!result.valid) {
        return reply.status(400).send(result);
      }
      return result;
    },
  );

  app.post<{
    Body: { name: string; type: "movies" | "tv"; path: string; scan?: boolean };
  }>("/api/libraries", async (request, reply) => {
    const { name, type, path: folderPath } = request.body;

    if (!name?.trim()) {
      return reply.status(400).send({ error: "Library name is required" });
    }
    if (type !== "movies" && type !== "tv") {
      return reply.status(400).send({ error: "Library type must be movies or tv" });
    }

    const validation = validateLibraryPath(folderPath);
    if (!validation.valid || !validation.resolvedPath) {
      return reply.status(400).send({ error: validation.error ?? "Invalid path" });
    }

    try {
      const lib = await scanner.createLibrary({
        name: name.trim(),
        type,
        path: validation.resolvedPath,
      });
      return { success: true, library: lib };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to create library",
      });
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { name?: string; type?: "movies" | "tv"; path?: string };
  }>("/api/libraries/:id", async (request, reply) => {
    const libraryId = parseInt(request.params.id, 10);
    const { name, type, path: folderPath } = request.body;

    let resolvedPath: string | undefined;
    if (folderPath !== undefined) {
      const validation = validateLibraryPath(folderPath);
      if (!validation.valid || !validation.resolvedPath) {
        return reply.status(400).send({ error: validation.error ?? "Invalid path" });
      }
      resolvedPath = validation.resolvedPath;
    }

    if (type !== undefined && type !== "movies" && type !== "tv") {
      return reply.status(400).send({ error: "Library type must be movies or tv" });
    }

    try {
      const lib = await scanner.updateLibrary(libraryId, {
        name,
        type,
        path: resolvedPath,
      });
      return { success: true, library: lib };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to update library",
      });
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/libraries/:id",
    async (request, reply) => {
      const libraryId = parseInt(request.params.id, 10);
      try {
        await scanner.deleteLibrary(libraryId);
        return { success: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to delete library",
        });
      }
    },
  );

  app.put<{ Body: { opensubtitles_api_key?: string } }>(
    "/api/settings/subtitles",
    async (request, reply) => {
      const apiKey = request.body?.opensubtitles_api_key;
      if (apiKey === undefined) {
        return reply.status(400).send({ error: "opensubtitles_api_key is required" });
      }

      configManager.setOpenSubtitlesApiKey(apiKey);
      const trimmed = apiKey.trim();
      const configured = Boolean(trimmed && trimmed !== "YOUR_KEY_HERE");

      return { success: true, opensubtitlesConfigured: configured };
    },
  );

  app.put<{ Body: { fanart_api_key?: string } }>(
    "/api/settings/fanart",
    async (request, reply) => {
      const apiKey = request.body?.fanart_api_key;
      if (apiKey === undefined) {
        return reply.status(400).send({ error: "fanart_api_key is required" });
      }

      configManager.setFanartApiKey(apiKey);
      const trimmed = apiKey.trim();
      const configured = Boolean(trimmed && trimmed !== "YOUR_KEY_HERE");

      let themesSynced = 0;
      if (configured) {
        const allLibraries = await db.query.libraries.findMany();
        for (const lib of allLibraries) {
          await themes.syncThemesForLibrary(lib.id);
          themesSynced += 1;
        }
      }

      return { success: true, fanartConfigured: configured, themesSynced };
    },
  );

  app.put<{ Body: { tmdb_api_key?: string } }>(
    "/api/settings/metadata",
    async (request, reply) => {
      const apiKey = request.body?.tmdb_api_key;
      if (apiKey === undefined) {
        return reply.status(400).send({ error: "tmdb_api_key is required" });
      }

      metadata.setApiKey(apiKey);

      const refresh = metadata.isConfigured()
        ? await scanner.refreshMetadata()
        : { updated: 0, skipped: 0 };

      return {
        success: true,
        tmdbConfigured: metadata.isConfigured(),
        metadataRefresh: refresh,
      };
    },
  );

  app.post("/api/metadata/refresh", async (_request, reply) => {
    if (!metadata.isConfigured()) {
      return reply.status(400).send({ error: "TMDB API key is not configured" });
    }

    const result = await scanner.refreshMetadata();
    return { success: true, ...result };
  });
}
