import type { FastifyInstance } from "fastify";
import type { DatabaseInstance } from "../db/index.js";
import type { ConfigManager } from "../config.js";
import type { ScannerService } from "../services/scanner.js";
import type { MetadataService } from "../services/metadata.js";
import type { ThemeService } from "../services/themes.js";
import { getBrowseShortcuts } from "../config.js";
import { browseDirectory, validateLibraryPath } from "../utils/paths.js";
import { checkFfmpegAvailable } from "../utils/ffmpeg.js";
import { getLibraryItemCounts } from "../services/library-stats.js";
import { libraries } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  createDeck,
  updateDeck,
  deleteDeck,
  listDecksWithCounts,
  resolveDeckPaths,
} from "../services/decks.js";
import {
  detectPlexLibraryDatabase,
  importPlexWatchProgress,
  previewPlexImport,
} from "../services/plex-import.js";
import { scheduleServerRestart } from "../services/restart.js";
import { errorMessage } from "./util.js";

/** Report whether an API key is set (not the placeholder) and its masked preview. */
function maskApiKey(raw?: string | null): { configured: boolean; preview: string } {
  const key = raw?.trim() ?? "";
  const configured = Boolean(key && key !== "YOUR_KEY_HERE");
  const preview = configured
    ? `${key.slice(0, 4)}${"•".repeat(Math.max(0, key.length - 8))}${key.slice(-4)}`
    : "";
  return { configured, preview };
}

function normalizePublicPrefixInput(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new Error("public_prefix must be a string");
  }
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.includes("://") || /\s/.test(trimmed)) {
    throw new Error("public_prefix must look like /reel");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

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
    const counts = await getLibraryItemCounts(db);

    const libraryDetails = allLibraries.map((lib) => ({
      id: lib.id,
      name: lib.name,
      type: lib.type,
      path: lib.path,
      itemCount: counts.get(lib.id) ?? 0,
      lastScannedAt: lib.lastScannedAt?.toISOString() ?? null,
      pathExists: validateLibraryPath(lib.path).valid,
    }));

    const tmdb = maskApiKey(config.metadata.tmdb_api_key);
    const fanart = maskApiKey(config.metadata.fanart_api_key);
    const opensubtitles = maskApiKey(config.subtitles?.opensubtitles_api_key);

    return {
      ffmpegAvailable,
      libraries: libraryDetails,
      decks: await listDecksWithCounts(db),
      passwordConfigured: Boolean(config.auth?.password_hash?.trim()),
      publicPrefix: config.server.public_prefix ?? "",
      metadata: {
        tmdbConfigured: tmdb.configured,
        tmdbApiKeyPreview: tmdb.preview,
        fanartConfigured: fanart.configured,
        fanartApiKeyPreview: fanart.preview,
        language: config.metadata.language,
      },
      subtitles: {
        opensubtitlesConfigured: opensubtitles.configured,
        opensubtitlesApiKeyPreview: opensubtitles.preview,
      },
      browseShortcuts: getBrowseShortcuts(),
    };
  });

  app.put<{ Body: { public_prefix?: string } }>(
    "/api/settings/server",
    async (request, reply) => {
      if (request.body?.public_prefix === undefined) {
        return reply.status(400).send({ error: "public_prefix is required" });
      }

      try {
        const nextPrefix = normalizePublicPrefixInput(request.body.public_prefix);
        const previousPrefix = configManager.get().server.public_prefix ?? "";
        const prefixChanged = previousPrefix !== nextPrefix;

        configManager.setPublicPrefix(nextPrefix);
        scheduleServerRestart({ rebuild: prefixChanged });

        return {
          success: true,
          restarting: true,
          rebuild: prefixChanged,
        };
      } catch (err) {
        return reply.status(400).send({
          error: errorMessage(err, "Invalid public_prefix"),
        });
      }
    },
  );

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
          error: errorMessage(err, "Failed to create deck"),
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
        error: errorMessage(err, "Failed to update deck"),
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
        error: errorMessage(err, "Failed to delete deck"),
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
        error: errorMessage(err, "Failed to create library"),
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
        error: errorMessage(err, "Failed to update library"),
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
          error: errorMessage(err, "Failed to delete library"),
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

  app.get<{ Querystring: { path?: string } }>(
    "/api/settings/plex-import",
    async (request) => {
      return previewPlexImport(db, request.query.path);
    },
  );

  app.post<{ Body: { plexDbPath?: string; overwrite?: boolean } }>(
    "/api/settings/plex-import",
    async (request, reply) => {
      const customPath = request.body?.plexDbPath?.trim();
      if (customPath) {
        const detection = await detectPlexLibraryDatabase(customPath);
        if (!detection.detected) {
          return reply.status(400).send({
            error: "The provided path is not a readable Plex library database.",
          });
        }
      }

      try {
        const result = await importPlexWatchProgress(db, {
          plexDbPath: customPath || undefined,
          overwrite: request.body?.overwrite ?? false,
        });
        return result;
      } catch (err) {
        return reply.status(400).send({
          error: errorMessage(err, "Plex import failed"),
        });
      }
    },
  );
}
