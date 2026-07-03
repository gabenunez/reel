import type { FastifyInstance } from "fastify";
import type { DatabaseInstance } from "../db/index.js";
import type { ConfigManager } from "../config.js";
import type { ScannerService } from "../services/scanner.js";
import type { MetadataService } from "../services/metadata.js";
import { getBrowseShortcuts } from "../config.js";
import { browseDirectory, validateLibraryPath } from "../utils/paths.js";
import { checkFfmpegAvailable } from "../utils/ffmpeg.js";
import { libraries } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { mediaItems } from "../db/schema.js";

export async function settingsRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  configManager: ConfigManager,
  scanner: ScannerService,
  metadata: MetadataService,
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

    return {
      ffmpegAvailable,
      libraries: libraryDetails,
      metadata: {
        tmdbConfigured: hasKey,
        tmdbApiKeyPreview: hasKey
          ? `${key.slice(0, 4)}${"•".repeat(Math.max(0, key.length - 8))}${key.slice(-4)}`
          : "",
        language: config.metadata.language,
      },
      browseShortcuts: getBrowseShortcuts(),
    };
  });

  app.get<{ Querystring: { path?: string } }>("/api/browse", async (request) => {
    return browseDirectory(request.query.path);
  });

  app.post<{ Body: { path?: string } }>("/api/browse/validate", async (request, reply) => {
    const folderPath = request.body?.path;
    if (!folderPath) {
      return reply.status(400).send({ valid: false, error: "Path is required" });
    }
    return validateLibraryPath(folderPath);
  });

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

  app.put<{ Body: { tmdb_api_key?: string } }>(
    "/api/settings/metadata",
    async (request, reply) => {
      const apiKey = request.body?.tmdb_api_key;
      if (apiKey === undefined) {
        return reply.status(400).send({ error: "tmdb_api_key is required" });
      }

      metadata.setApiKey(apiKey);
      return {
        success: true,
        tmdbConfigured: metadata.isConfigured(),
      };
    },
  );
}
