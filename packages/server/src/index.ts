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
import { AuthService, isCastMediaPath, isPublicPath } from "./services/auth.js";
import { authRoutes } from "./routes/auth.js";
import { updateRoutes } from "./routes/updates.js";
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

  // Redirect legacy /library/2 style URLs to query-param static pages
  app.addHook("onRequest", async (request, reply) => {
    const url = new URL(request.url, "http://localhost");

    const libraryMatch = url.pathname.match(/^\/library\/(\d+)\/?$/);
    if (libraryMatch) {
      url.pathname = "/library/";
      url.searchParams.set("id", libraryMatch[1]);
      return reply.redirect(`${url.pathname}?${url.searchParams.toString()}`);
    }

    const mediaMatch = url.pathname.match(/^\/media\/(\d+)\/?$/);
    if (mediaMatch) {
      url.pathname = "/media/";
      url.searchParams.set("id", mediaMatch[1]);
      return reply.redirect(`${url.pathname}?${url.searchParams.toString()}`);
    }

    const watchMatch = url.pathname.match(/^\/watch\/(movie|episode)\/(\d+)\/?$/);
    if (watchMatch) {
      url.pathname = "/watch/";
      url.searchParams.set("type", watchMatch[1]);
      url.searchParams.set("id", watchMatch[2]);
      return reply.redirect(`${url.pathname}?${url.searchParams.toString()}`);
    }

    const tvLibraryMatch = url.pathname.match(/^\/tv\/library\/(\d+)\/?$/);
    if (tvLibraryMatch) {
      url.pathname = "/tv/library/";
      url.searchParams.set("id", tvLibraryMatch[1]);
      return reply.redirect(`${url.pathname}?${url.searchParams.toString()}`);
    }

    const tvMediaMatch = url.pathname.match(/^\/tv\/media\/(\d+)\/?$/);
    if (tvMediaMatch) {
      url.pathname = "/tv/media/";
      url.searchParams.set("id", tvMediaMatch[1]);
      return reply.redirect(`${url.pathname}?${url.searchParams.toString()}`);
    }

    const tvWatchMatch = url.pathname.match(/^\/tv\/watch\/(movie|episode)\/(\d+)\/?$/);
    if (tvWatchMatch) {
      url.pathname = "/tv/watch/";
      url.searchParams.set("type", tvWatchMatch[1]);
      url.searchParams.set("id", tvWatchMatch[2]);
      return reply.redirect(`${url.pathname}?${url.searchParams.toString()}`);
    }
  });

  await authRoutes(app, auth, configManager);
  await apiRoutes(app, db, config, scanner, metadata, themes);
  await settingsRoutes(app, db, configManager, scanner, metadata);
  await updateRoutes(app);
  await castRoutes(app, db, config, auth);
  await streamRoutes(app, db, config);
  await subtitleRoutes(app, db, subtitles);
  await subtitleSearchRoutes(app, db, configManager, subtitles);

  const webOut = getWebOutPath();
  if (webOut && fs.existsSync(webOut)) {
    await app.register(fastifyStatic, {
      root: webOut,
      prefix: "/",
      redirect: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not found" });
      }
      const pathname = request.url.split("?")[0] ?? "/";
      if (pathname.startsWith("/tv")) {
        return reply.sendFile("tv/index.html");
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
    const count = pruneStaleTranscodeCache(config.transcoding.cache_dir, 60 * 60 * 1000);
    if (count > 0) {
      app.log.info({ removed: count }, "Pruned stale transcode cache directories");
    }
  }, 60 * 60 * 1000);

  const { port, host } = config.server;
  await app.listen({ port, host });

  console.log(`\n🎬 Reel media server running at http://localhost:${port}\n`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
