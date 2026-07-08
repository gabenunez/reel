import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { loadConfig, getDbPath, getWebOutPath, ConfigManager } from "./config.js";
import { runMigrations } from "./db/index.js";
import { MetadataService } from "./services/metadata.js";
import { SubtitleService } from "./services/subtitles.js";
import { ThemeService } from "./services/themes.js";
import { ScannerService } from "./services/scanner.js";
import { apiRoutes } from "./routes/api.js";
import { streamRoutes, subtitleRoutes } from "./routes/stream.js";
import { subtitleSearchRoutes } from "./routes/subtitles-search.js";
import { settingsRoutes } from "./routes/settings.js";
import { castRoutes } from "./routes/cast.js";
import { AuthService, isCastMediaPath, isInternalMediaApiPath, isPublicPath } from "./services/auth.js";
import { authRoutes } from "./routes/auth.js";
import { updateRoutes } from "./routes/updates.js";
import { resolveLegacyRouteRedirect, resolveSpaIndexFile } from "@media-app/shared";
import { pruneStaleTranscodeCache, killOrphanFfmpegInCache } from "./utils/ffmpeg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const configManager = new ConfigManager();
  const config = configManager.get();
  const dbPath = getDbPath(config);
  const migrationsFolder = path.resolve(__dirname, "../drizzle");

  const { db } = runMigrations(dbPath, migrationsFolder);

  const metadata = new MetadataService(configManager);
  const subtitles = new SubtitleService(db, config);
  const themes = new ThemeService(db, configManager, metadata);
  const scanner = new ScannerService(db, configManager, metadata, subtitles, themes);
  const auth = new AuthService(configManager);

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true, credentials: true });

  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? request.url;
    const isLocalClient =
      request.ip === "127.0.0.1" ||
      request.ip === "::1" ||
      request.ip === "::ffff:127.0.0.1";

    if (isLocalClient && isInternalMediaApiPath(pathname)) {
      return;
    }

    const passwordRequired = auth.isPasswordRequired();

    if (!passwordRequired || isPublicPath(pathname, passwordRequired)) {
      return;
    }

    if (passwordRequired && isCastMediaPath(pathname)) {
      const castToken = new URL(
        request.url,
        `http://${request.headers.host ?? "localhost"}`,
      ).searchParams.get("castToken");
      if (castToken && auth.verifyCastToken(castToken, pathname)) {
        return;
      }
    }

    if (!auth.isAuthenticated(request)) {
      if (pathname.startsWith("/api/")) {
        return reply.status(401).send({ error: "Authentication required" });
      }
    }
  });

  // Redirect legacy query-param URLs to path-based routes (bookmarks, TV cast).
  app.addHook("onRequest", async (request, reply) => {
    const url = new URL(request.url, "http://localhost");
    const redirect = resolveLegacyRouteRedirect(url.pathname, url.search);
    if (redirect) {
      return reply.redirect(redirect);
    }
  });

  await authRoutes(app, auth, configManager);
  await apiRoutes(app, db, config, scanner, metadata, themes);
  await settingsRoutes(app, db, configManager, scanner, metadata, themes);
  await updateRoutes(app);
  await castRoutes(app, db, config, auth);
  await streamRoutes(app, db, config);
  await subtitleSearchRoutes(app, db, configManager, subtitles);
  await subtitleRoutes(app, db, subtitles);

  const apiOnly = process.env.MEDIA_API_ONLY === "1";
  const webOut = getWebOutPath();
  if (!apiOnly && webOut && fs.existsSync(webOut)) {
    await app.register(fastifyStatic, {
      root: webOut,
      prefix: "/",
      redirect: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        if (filePath.endsWith(`${path.sep}index.html`)) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    });

    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split("?")[0] ?? request.url;
      if (pathname.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not found" });
      }

      const spaFile = resolveSpaIndexFile(pathname);
      if (spaFile) {
        return reply.sendFile(spaFile);
      }

      return reply.sendFile("index.html");
    });
  }

  scanner.initializeLibraries().catch((err) => {
    app.log.error(err, "Failed to initialize libraries");
  });

  const killed = killOrphanFfmpegInCache(config.transcoding.cache_dir);
  if (killed > 0) {
    app.log.info({ killed }, "Killed orphan FFmpeg transcode processes");
  }

  const removed = pruneStaleTranscodeCache(config.transcoding.cache_dir, 30 * 60 * 1000);
  if (removed > 0) {
    app.log.info({ removed }, "Pruned stale transcode cache directories");
  }
  setInterval(() => {
    try {
      const count = pruneStaleTranscodeCache(config.transcoding.cache_dir, 60 * 60 * 1000);
      if (count > 0) {
        app.log.info({ removed: count }, "Pruned stale transcode cache directories");
      }
    } catch (err) {
      app.log.error(err, "Failed to prune stale transcode cache");
    }
  }, 60 * 60 * 1000);

  const { port: configPort, host } = config.server;
  const port = apiOnly
    ? parseInt(process.env.MEDIA_INTERNAL_API_PORT ?? String(configPort + 1), 10)
    : configPort;
  await app.listen({ port, host });

  if (apiOnly) {
    console.log(`\n🎬 MEDIA! API running at http://${host}:${port}\n`);
  } else {
    console.log(`\n🎬 MEDIA! media server running at http://localhost:${port}\n`);
  }
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
