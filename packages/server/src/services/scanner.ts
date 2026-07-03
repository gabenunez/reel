import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import chokidar, { type FSWatcher } from "chokidar";
import {
  parseMovieFilename,
  parseEpisodeFromPath,
  isVideoFile,
  isUnknownVideoCandidate,
} from "@reel/shared";
import type { ConfigManager } from "../config.js";
import type { DatabaseInstance } from "../db/index.js";
import {
  libraries,
  mediaItems,
  movieFiles,
  tvSeasons,
  tvEpisodes,
  scanJobs,
} from "../db/schema.js";
import { MetadataService } from "./metadata.js";
import { SubtitleService } from "./subtitles.js";
import { probeFile } from "../utils/ffmpeg.js";

export class ScannerService {
  private watchers = new Map<number, FSWatcher>();
  private activeScan: { libraryId: number; jobId: number } | null = null;

  constructor(
    private db: DatabaseInstance,
    private configManager: ConfigManager,
    private metadata: MetadataService,
    private subtitles: SubtitleService,
  ) {}

  private get config() {
    return this.configManager.get();
  }

  async initializeLibraries(): Promise<void> {
    for (const libConfig of this.config.libraries) {
      const existing = await this.db.query.libraries.findFirst({
        where: eq(libraries.path, libConfig.path),
      });

      if (!existing) {
        await this.db.insert(libraries).values({
          name: libConfig.name,
          type: libConfig.type,
          path: libConfig.path,
        });
      } else if (
        existing.name !== libConfig.name ||
        existing.type !== libConfig.type
      ) {
        await this.db
          .update(libraries)
          .set({ name: libConfig.name, type: libConfig.type })
          .where(eq(libraries.id, existing.id));
      }
    }

    const allLibraries = await this.db.query.libraries.findMany();
    for (const lib of allLibraries) {
      const stillConfigured = this.config.libraries.some((c) => c.path === lib.path);
      if (!stillConfigured) continue;

      this.startWatcher(lib.id, lib.path);
      await this.scanLibrary(lib.id);
    }
  }

  startWatcher(libraryId: number, libraryPath: string): void {
    if (this.watchers.has(libraryId)) return;

    if (!fs.existsSync(libraryPath)) {
      console.warn(`Library path does not exist: ${libraryPath}`);
      return;
    }

    const watcher = chokidar.watch(libraryPath, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
      depth: 10,
    });

    watcher.on("add", async (filePath) => {
      if (await this.isMediaVideoFile(filePath)) {
        const lib = await this.db.query.libraries.findFirst({
          where: eq(libraries.id, libraryId),
        });
        if (lib) await this.processFile(lib, filePath);
      }
    });

    watcher.on("unlink", async (filePath) => {
      await this.removeFile(filePath);
    });

    this.watchers.set(libraryId, watcher);
  }

  async scanLibrary(libraryId: number): Promise<void> {
    if (this.activeScan?.libraryId === libraryId) return;

    const lib = await this.db.query.libraries.findFirst({
      where: eq(libraries.id, libraryId),
    });
    if (!lib) throw new Error(`Library ${libraryId} not found`);
    if (!fs.existsSync(lib.path)) {
      throw new Error(`Library path does not exist: ${lib.path}`);
    }

    const [job] = await this.db
      .insert(scanJobs)
      .values({
        libraryId,
        status: "running",
        progress: 0,
        message: "Scanning files...",
        startedAt: new Date(),
      })
      .returning();

    this.activeScan = { libraryId, jobId: job.id };

    try {
      const files = await this.collectVideoFiles(lib.path);
      let processed = 0;

      for (const filePath of files) {
        await this.processFile(lib, filePath);
        processed++;
        const progress = Math.round((processed / files.length) * 100);
        await this.db
          .update(scanJobs)
          .set({ progress, message: `Processed ${processed}/${files.length} files` })
          .where(eq(scanJobs.id, job.id));
      }

      await this.db
        .update(libraries)
        .set({ lastScannedAt: new Date() })
        .where(eq(libraries.id, libraryId));

      await this.db
        .update(scanJobs)
        .set({
          status: "completed",
          progress: 100,
          message: `Scan complete: ${files.length} files`,
          completedAt: new Date(),
        })
        .where(eq(scanJobs.id, job.id));
    } catch (err) {
      await this.db
        .update(scanJobs)
        .set({
          status: "failed",
          message: err instanceof Error ? err.message : "Scan failed",
          completedAt: new Date(),
        })
        .where(eq(scanJobs.id, job.id));
      throw err;
    } finally {
      this.activeScan = null;
    }
  }

  getActiveScan() {
    return this.activeScan;
  }

  stopWatcher(libraryId: number): void {
    const watcher = this.watchers.get(libraryId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(libraryId);
    }
  }

  async syncConfigLibraries(): Promise<void> {
    const dbLibraries = await this.db.query.libraries.findMany();
    this.configManager.setLibraries(
      dbLibraries.map((lib) => ({
        name: lib.name,
        type: lib.type,
        path: lib.path,
      })),
    );
  }

  async createLibrary(input: {
    name: string;
    type: "movies" | "tv";
    path: string;
  }): Promise<typeof libraries.$inferSelect> {
    const existing = await this.db.query.libraries.findFirst({
      where: eq(libraries.path, input.path),
    });
    if (existing) {
      throw new Error("A library with this path already exists");
    }

    const [lib] = await this.db
      .insert(libraries)
      .values({
        name: input.name.trim(),
        type: input.type,
        path: input.path,
      })
      .returning();

    await this.syncConfigLibraries();
    this.startWatcher(lib.id, lib.path);
    await this.scanLibrary(lib.id);
    return lib;
  }

  async updateLibrary(
    libraryId: number,
    input: { name?: string; type?: "movies" | "tv"; path?: string },
  ): Promise<typeof libraries.$inferSelect> {
    const lib = await this.db.query.libraries.findFirst({
      where: eq(libraries.id, libraryId),
    });
    if (!lib) throw new Error("Library not found");

    if (input.path && input.path !== lib.path) {
      const duplicate = await this.db.query.libraries.findFirst({
        where: eq(libraries.path, input.path),
      });
      if (duplicate && duplicate.id !== libraryId) {
        throw new Error("A library with this path already exists");
      }
    }

    const [updated] = await this.db
      .update(libraries)
      .set({
        name: input.name?.trim() ?? lib.name,
        type: input.type ?? lib.type,
        path: input.path ?? lib.path,
      })
      .where(eq(libraries.id, libraryId))
      .returning();

    const pathChanged = updated.path !== lib.path;
    if (pathChanged) {
      this.stopWatcher(libraryId);
      this.startWatcher(updated.id, updated.path);
    }

    await this.syncConfigLibraries();

    if (pathChanged) {
      await this.scanLibrary(updated.id);
    }

    return updated;
  }

  async deleteLibrary(libraryId: number): Promise<void> {
    const lib = await this.db.query.libraries.findFirst({
      where: eq(libraries.id, libraryId),
    });
    if (!lib) throw new Error("Library not found");

    this.stopWatcher(libraryId);
    await this.db.delete(libraries).where(eq(libraries.id, libraryId));
    await this.syncConfigLibraries();
  }

  private async isMediaVideoFile(filePath: string): Promise<boolean> {
    const name = path.basename(filePath);
    if (isVideoFile(name)) return true;

    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile() || !isUnknownVideoCandidate(name, stats.size)) {
        return false;
      }
      const probe = await probeFile(filePath);
      return Boolean(probe?.videoCodec);
    } catch {
      return false;
    }
  }

  private async collectVideoFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const probeCandidates: Array<{ path: string; size: number }> = [];

    const walk = (current: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          if (isVideoFile(entry.name)) {
            results.push(fullPath);
          } else {
            try {
              const size = fs.statSync(fullPath).size;
              if (isUnknownVideoCandidate(entry.name, size)) {
                probeCandidates.push({ path: fullPath, size });
              }
            } catch {
              // skip unreadable files
            }
          }
        }
      }
    };

    walk(dir);

    for (const candidate of probeCandidates) {
      const probe = await probeFile(candidate.path);
      if (probe?.videoCodec) {
        results.push(candidate.path);
      }
    }

    return results;
  }

  private async processFile(
    lib: typeof libraries.$inferSelect,
    filePath: string,
  ): Promise<void> {
    const stats = fs.statSync(filePath);
    const probe = await probeFile(filePath);

    if (lib.type === "movies") {
      await this.processMovieFile(lib, filePath, stats.size, probe);
    } else {
      await this.processTvFile(lib, filePath, stats.size, probe);
    }
  }

  private async processMovieFile(
    lib: typeof libraries.$inferSelect,
    filePath: string,
    fileSize: number,
    probe: Awaited<ReturnType<typeof probeFile>>,
  ): Promise<void> {
    const existing = await this.db.query.movieFiles.findFirst({
      where: eq(movieFiles.filePath, filePath),
    });
    if (existing) return;

    const filename = path.basename(filePath);
    const parsed = parseMovieFilename(filename);

    let mediaItemId: number;
    const existingMedia = await this.db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.libraryId, lib.id),
        eq(mediaItems.title, parsed.title),
      ),
    });

    if (existingMedia) {
      mediaItemId = existingMedia.id;
    } else {
      const { match, confidence } = await this.metadata.searchMovie(
        parsed.title,
        parsed.year,
      );

      const posterPath = match
        ? await this.metadata.cachePoster(match.poster_path)
        : null;
      const backdropPath = match
        ? await this.metadata.cacheBackdrop(match.backdrop_path)
        : null;

      const [item] = await this.db
        .insert(mediaItems)
        .values({
          libraryId: lib.id,
          tmdbId: match?.id ?? null,
          title: match?.title ?? parsed.title,
          originalTitle: match?.original_title ?? null,
          overview: match?.overview ?? null,
          year: match?.release_date
            ? parseInt(match.release_date.slice(0, 4), 10)
            : parsed.year ?? null,
          posterPath,
          backdropPath,
          type: "movie",
          genres: match?.genres?.map((g) => g.name).join(", ") ?? null,
          rating: match?.vote_average ?? null,
          matchConfidence: confidence,
          needsMatch: !match || confidence < 0.6,
        })
        .returning();

      mediaItemId = item.id;
    }

    const [file] = await this.db
      .insert(movieFiles)
      .values({
        mediaItemId,
        filePath,
        durationMs: probe?.durationMs ?? null,
        fileSize,
        videoCodec: probe?.videoCodec ?? null,
        audioCodec: probe?.audioCodec ?? null,
        width: probe?.width ?? null,
        height: probe?.height ?? null,
      })
      .returning();

    await this.subtitles.discoverForMovieFile(file.id, filePath, probe);
  }

  private async processTvFile(
    lib: typeof libraries.$inferSelect,
    filePath: string,
    fileSize: number,
    probe: Awaited<ReturnType<typeof probeFile>>,
  ): Promise<void> {
    const existing = await this.db.query.tvEpisodes.findFirst({
      where: eq(tvEpisodes.filePath, filePath),
    });
    if (existing) return;

    const parsed = parseEpisodeFromPath(filePath, lib.path);
    if (!parsed) {
      console.warn(`Could not parse TV episode: ${filePath}`);
      return;
    }

    let mediaItem = await this.db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.libraryId, lib.id),
        eq(mediaItems.title, parsed.showName),
      ),
    });

    if (!mediaItem) {
      const { match, confidence } = await this.metadata.searchTv(parsed.showName);

      const posterPath = match
        ? await this.metadata.cachePoster(match.poster_path)
        : null;
      const backdropPath = match
        ? await this.metadata.cacheBackdrop(match.backdrop_path)
        : null;

      const [item] = await this.db
        .insert(mediaItems)
        .values({
          libraryId: lib.id,
          tmdbId: match?.id ?? null,
          title: match?.name ?? parsed.showName,
          originalTitle: match?.original_name ?? null,
          overview: match?.overview ?? null,
          year: match?.first_air_date
            ? parseInt(match.first_air_date.slice(0, 4), 10)
            : null,
          posterPath,
          backdropPath,
          type: "tv",
          genres: match?.genres?.map((g) => g.name).join(", ") ?? null,
          rating: match?.vote_average ?? null,
          matchConfidence: confidence,
          needsMatch: !match || confidence < 0.6,
        })
        .returning();

      mediaItem = item;
    }

    let season = await this.db.query.tvSeasons.findFirst({
      where: and(
        eq(tvSeasons.mediaItemId, mediaItem.id),
        eq(tvSeasons.seasonNumber, parsed.season),
      ),
    });

    if (!season) {
      let seasonMeta = null;
      if (mediaItem.tmdbId) {
        seasonMeta = await this.metadata.getTvSeason(
          mediaItem.tmdbId,
          parsed.season,
        );
      }

      const seasonPoster = seasonMeta
        ? await this.metadata.cachePoster(seasonMeta.poster_path)
        : null;

      const [newSeason] = await this.db
        .insert(tvSeasons)
        .values({
          mediaItemId: mediaItem.id,
          seasonNumber: parsed.season,
          name: seasonMeta?.name ?? `Season ${parsed.season}`,
          overview: seasonMeta?.overview ?? null,
          posterPath: seasonPoster,
          airDate: seasonMeta?.air_date ?? null,
        })
        .returning();

      season = newSeason;
    }

    const episodeMeta = mediaItem.tmdbId
      ? (await this.metadata.getTvSeason(mediaItem.tmdbId, parsed.season))
          ?.episodes?.find((e) => e.episode_number === parsed.episode)
      : null;

    const stillPath = episodeMeta?.still_path
      ? await this.metadata.cachePoster(episodeMeta.still_path)
      : null;

    const [episode] = await this.db
      .insert(tvEpisodes)
      .values({
        seasonId: season.id,
        episodeNumber: parsed.episode,
        title: episodeMeta?.name ?? `Episode ${parsed.episode}`,
        overview: episodeMeta?.overview ?? null,
        filePath,
        durationMs: probe?.durationMs ?? null,
        fileSize,
        stillPath,
        airDate: episodeMeta?.air_date ?? null,
      })
      .returning();

    await this.subtitles.discoverForEpisode(episode.id, filePath, probe);
  }

  private async removeFile(filePath: string): Promise<void> {
    const movieFile = await this.db.query.movieFiles.findFirst({
      where: eq(movieFiles.filePath, filePath),
    });
    if (movieFile) {
      await this.db.delete(movieFiles).where(eq(movieFiles.id, movieFile.id));
      return;
    }

    const episode = await this.db.query.tvEpisodes.findFirst({
      where: eq(tvEpisodes.filePath, filePath),
    });
    if (episode) {
      await this.db.delete(tvEpisodes).where(eq(tvEpisodes.id, episode.id));
    }
  }
}
