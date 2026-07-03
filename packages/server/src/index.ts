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
import { ScannerService } from "./services/scanner.js";
import { apiRoutes } from "./routes/api.js";
import { streamRoutes, subtitleRoutes } from "./routes/stream.js";
import { settingsRoutes } from "./routes/settings.js";
import { castRoutes } from "./routes/cast.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const configManager = new ConfigManager();
  const config = configManager.get();
  const dbPath = getDbPath(config);
  const migrationsFolder = path.resolve(__dirname, "../drizzle");

  const { db } = runMigrations(dbPath, migrationsFolder);

  const metadata = new MetadataService(configManager);
  const subtitles = new SubtitleService(db, config);
  const scanner = new ScannerService(db, configManager, metadata, subtitles);

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

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
  });

  await apiRoutes(app, db, config, scanner, metadata);
  await settingsRoutes(app, db, configManager, scanner, metadata);
  await castRoutes(app, db, config);
  await streamRoutes(app, db, config);
  await subtitleRoutes(app, db, subtitles);

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
      return reply.sendFile("index.html");
    });
  }

  scanner.initializeLibraries().catch((err) => {
    app.log.error(err, "Failed to initialize libraries");
  });

  const { port, host } = config.server;
  await app.listen({ port, host });

  console.log(`\n🎬 Reel media server running at http://localhost:${port}\n`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
