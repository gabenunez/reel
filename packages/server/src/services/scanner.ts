import fs from "node:fs";
import path from "node:path";
import { eq, and, or, isNull } from "drizzle-orm";
import chokidar, { type FSWatcher } from "chokidar";
import {
  parseMovieFilename,
  parseEpisodeFromPath,
  isVideoFile,
  isUnknownVideoCandidate,
  isSubtitleFile,
  isExcludedFromVideoProbe,
  SKIP_SCAN_DIR_NAMES,
} from "@media-app/shared";
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
import { ThemeService } from "./themes.js";
import { revalidateMediaPage } from "./page-revalidate.js";
import { probeFile } from "../utils/ffmpeg.js";

export class ScannerService {
  private watchers = new Map<number, FSWatcher>();
  private activeScan: { libraryId: number; jobId: number } | null = null;

  constructor(
    private db: DatabaseInstance,
    private configManager: ConfigManager,
    private metadata: MetadataService,
    private subtitles: SubtitleService,
    private themes: ThemeService,
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
      this.scheduleScan(lib.id);
    }
  }

  /** Run a library scan in the background without blocking the caller. */
  scheduleScan(libraryId: number): void {
    void this.scanLibrary(libraryId).catch((err) => {
      console.error(
        `Background scan failed for library ${libraryId}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  private shouldSkipScanEntry(name: string, isDirectory: boolean): boolean {
    if (name.startsWith(".")) return true;
    if (isDirectory && SKIP_SCAN_DIR_NAMES.has(name)) return true;
    return false;
  }

  private pathHasSkippedSegment(watchPath: string): boolean {
    for (const segment of watchPath.split(/[/\\]/)) {
      if (!segment) continue;
      if (segment.startsWith(".")) return true;
      if (SKIP_SCAN_DIR_NAMES.has(segment)) return true;
    }
    return false;
  }

  private shouldWatchPath(
    watchPath: string,
    stats?: { isDirectory: () => boolean; isFile: () => boolean },
  ): boolean {
    if (this.pathHasSkippedSegment(watchPath)) return true;

    const name = path.basename(watchPath);
    if (this.shouldSkipScanEntry(name, stats?.isDirectory() ?? false)) {
      return true;
    }
    if (stats?.isFile()) {
      if (isVideoFile(name) || isSubtitleFile(name)) return false;
      if (isExcludedFromVideoProbe(name)) return true;
      const ext = path.extname(name).toLowerCase();
      if (ext && ext !== "") return true;
    }
    return false;
  }

  startWatcher(libraryId: number, libraryPath: string): void {
    if (this.watchers.has(libraryId)) return;

    if (!fs.existsSync(libraryPath)) {
      console.warn(`Library path does not exist: ${libraryPath}`);
      return;
    }

    const watcher = chokidar.watch(libraryPath, {
      ignored: (watchPath, stats) => this.shouldWatchPath(watchPath, stats),
      persistent: true,
      ignoreInitial: true,
      depth: 8,
      followSymlinks: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500,
      },
    });

    watcher.on("error", (err) => {
      console.warn(
        `File watcher error for library ${libraryId}:`,
        err instanceof Error ? err.message : err,
      );
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

      if (lib.type === "tv") {
        const merged = await this.dedupeTvShows(libraryId);
        if (merged > 0) {
          console.log(`Merged ${merged} duplicate TV show(s) in ${lib.name}`);
        }
      }

      await this.db
        .update(scanJobs)
        .set({
          status: "completed",
          progress: 100,
          message: `Scan complete: ${files.length} files`,
          completedAt: new Date(),
        })
        .where(eq(scanJobs.id, job.id));

      if (this.metadata.isConfigured()) {
        await this.refreshMetadata(libraryId);
      }

      await this.themes.syncThemesForLibrary(libraryId);
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

  async refreshMetadata(
    libraryId?: number,
  ): Promise<{ updated: number; skipped: number }> {
    if (!this.metadata.isConfigured()) {
      return { updated: 0, skipped: 0 };
    }

    const conditions = [
      or(isNull(mediaItems.tmdbId), eq(mediaItems.needsMatch, true)),
    ];
    if (libraryId !== undefined) {
      conditions.push(eq(mediaItems.libraryId, libraryId));
    }

    const items = await this.db.query.mediaItems.findMany({
      where: and(...conditions),
    });

    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      const success =
        item.type === "movie"
          ? await this.refreshMovieItem(item)
          : await this.refreshTvItem(item);
      if (success) updated++;
      else skipped++;
    }

    return { updated, skipped };
  }

  /**
   * Apply a user-chosen TMDB match (from the Fix match UI). Confidence is
   * forced to 1.0 and needsMatch cleared — the user explicitly confirmed it.
   */
  async applyManualMatch(
    mediaId: number,
    tmdbId: number,
  ): Promise<typeof mediaItems.$inferSelect | null> {
    const item = await this.db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaId),
    });
    if (!item) return null;

    if (item.type === "movie") {
      const match = await this.metadata.getMovieDetails(tmdbId);
      if (!match) return null;

      const posterPath = await this.metadata.cachePoster(match.poster_path);
      const backdropPath = await this.metadata.cacheBackdrop(match.backdrop_path);
      const imdbId =
        match.external_ids?.imdb_id ?? match.imdb_id ?? null;

      const [updated] = await this.db
        .update(mediaItems)
        .set({
          tmdbId: match.id,
          imdbId: imdbId ? imdbId.toLowerCase() : null,
          title: match.title,
          originalTitle: match.original_title ?? null,
          overview: match.overview ?? null,
          year: match.release_date
            ? parseInt(match.release_date.slice(0, 4), 10)
            : item.year ?? null,
          posterPath,
          backdropPath,
          genres: match.genres?.map((g) => g.name).join(", ") ?? null,
          rating: match.vote_average ?? null,
          matchConfidence: 1,
          needsMatch: false,
          updatedAt: new Date(),
        })
        .where(eq(mediaItems.id, item.id))
        .returning();

      void revalidateMediaPage(item.id);
      void this.themes.syncForMediaItem(updated);
      return updated;
    }

    const match = await this.metadata.getTvDetails(tmdbId);
    if (!match) return null;

    const posterPath = await this.metadata.cachePoster(match.poster_path);
    const backdropPath = await this.metadata.cacheBackdrop(match.backdrop_path);
    const imdbId = match.external_ids?.imdb_id ?? null;

    const [updated] = await this.db
      .update(mediaItems)
      .set({
        tmdbId: match.id,
        imdbId: imdbId ? imdbId.toLowerCase() : null,
        title: match.name,
        originalTitle: match.original_name ?? null,
        overview: match.overview ?? null,
        year: match.first_air_date
          ? parseInt(match.first_air_date.slice(0, 4), 10)
          : item.year ?? null,
        posterPath,
        backdropPath,
        genres: match.genres?.map((g) => g.name).join(", ") ?? null,
        rating: match.vote_average ?? null,
        matchConfidence: 1,
        needsMatch: false,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, item.id))
      .returning();

    await this.refreshTvEpisodes(item.id, match.id);
    void revalidateMediaPage(item.id);
    void this.themes.syncForMediaItem(updated);
    return updated;
  }

  private async refreshMovieItem(
    item: typeof mediaItems.$inferSelect,
  ): Promise<boolean> {
    const file = await this.db.query.movieFiles.findFirst({
      where: eq(movieFiles.mediaItemId, item.id),
    });

    const parsed = file
      ? parseMovieFilename(path.basename(file.filePath))
      : { title: item.title, year: item.year ?? undefined, rawFilename: "" };

    const { match, confidence } = await this.metadata.searchMovie(
      parsed.title,
      parsed.year ?? item.year ?? undefined,
    );

    if (!match) return false;

    const posterPath = await this.metadata.cachePoster(match.poster_path);
    const backdropPath = await this.metadata.cacheBackdrop(match.backdrop_path);

    await this.db
      .update(mediaItems)
      .set({
        tmdbId: match.id,
        imdbId: match.imdb_id?.toLowerCase() ?? null,
        title: match.title,
        originalTitle: match.original_title ?? null,
        overview: match.overview ?? null,
        year: match.release_date
          ? parseInt(match.release_date.slice(0, 4), 10)
          : parsed.year ?? item.year ?? null,
        posterPath,
        backdropPath,
        genres: match.genres?.map((g) => g.name).join(", ") ?? null,
        rating: match.vote_average ?? null,
        matchConfidence: confidence,
        needsMatch: confidence < 0.6,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, item.id));

    return true;
  }

  private async refreshTvItem(
    item: typeof mediaItems.$inferSelect,
  ): Promise<boolean> {
    let showName = item.title;
    const lib = await this.db.query.libraries.findFirst({
      where: eq(libraries.id, item.libraryId),
    });

    if (lib) {
      const episodes = await this.db.query.tvSeasons.findMany({
        where: eq(tvSeasons.mediaItemId, item.id),
      });
      for (const season of episodes) {
        const eps = await this.db.query.tvEpisodes.findMany({
          where: eq(tvEpisodes.seasonId, season.id),
        });
        if (eps[0]) {
          const parsed = parseEpisodeFromPath(eps[0].filePath, lib.path);
          if (parsed?.showName) {
            showName = parsed.showName;
            break;
          }
        }
      }
    }

    const { match, confidence } = await this.metadata.searchTv(showName);
    if (!match) return false;

    const posterPath = await this.metadata.cachePoster(match.poster_path);
    const backdropPath = await this.metadata.cacheBackdrop(match.backdrop_path);

    await this.db
      .update(mediaItems)
      .set({
        tmdbId: match.id,
        title: match.name,
        originalTitle: match.original_name ?? null,
        overview: match.overview ?? null,
        year: match.first_air_date
          ? parseInt(match.first_air_date.slice(0, 4), 10)
          : item.year ?? null,
        posterPath,
        backdropPath,
        genres: match.genres?.map((g) => g.name).join(", ") ?? null,
        rating: match.vote_average ?? null,
        matchConfidence: confidence,
        needsMatch: confidence < 0.6,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, item.id));

    await this.refreshTvEpisodes(item.id, match.id);
    return true;
  }

  private async refreshTvEpisodes(
    mediaItemId: number,
    tmdbId: number,
  ): Promise<void> {
    const seasons = await this.db.query.tvSeasons.findMany({
      where: eq(tvSeasons.mediaItemId, mediaItemId),
    });

    for (const season of seasons) {
      const seasonMeta = await this.metadata.getTvSeason(
        tmdbId,
        season.seasonNumber,
      );

      if (seasonMeta) {
        const seasonPoster = await this.metadata.cachePoster(
          seasonMeta.poster_path,
        );
        await this.db
          .update(tvSeasons)
          .set({
            name: seasonMeta.name ?? season.name,
            overview: seasonMeta.overview ?? season.overview,
            posterPath: seasonPoster ?? season.posterPath,
            airDate: seasonMeta.air_date ?? season.airDate,
          })
          .where(eq(tvSeasons.id, season.id));
      }

      const episodes = await this.db.query.tvEpisodes.findMany({
        where: eq(tvEpisodes.seasonId, season.id),
      });

      for (const ep of episodes) {
        const epMeta = seasonMeta?.episodes?.find(
          (e) => e.episode_number === ep.episodeNumber,
        );
        if (!epMeta) continue;

        const stillPath = epMeta.still_path
          ? await this.metadata.cachePoster(epMeta.still_path)
          : ep.stillPath;

        await this.db
          .update(tvEpisodes)
          .set({
            title: epMeta.name ?? ep.title,
            overview: epMeta.overview ?? ep.overview,
            stillPath,
            airDate: epMeta.air_date ?? ep.airDate,
          })
          .where(eq(tvEpisodes.id, ep.id));
      }
    }
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
    this.scheduleScan(lib.id);
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
      this.scheduleScan(updated.id);
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
        if (this.shouldSkipScanEntry(entry.name, entry.isDirectory())) {
          continue;
        }

        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (entry.isSymbolicLink()) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              walk(fullPath);
              continue;
            }
            if (!stat.isFile()) continue;
          } catch {
            continue;
          }
        } else if (!entry.isFile()) {
          continue;
        }

        if (isVideoFile(entry.name)) {
          results.push(fullPath);
        } else if (!isExcludedFromVideoProbe(entry.name)) {
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
    if (existing) {
      if (
        probe &&
        (!existing.videoCodec ||
          !existing.height ||
          existing.durationMs == null ||
          !existing.width)
      ) {
        await this.db
          .update(movieFiles)
          .set({
            durationMs: existing.durationMs ?? probe.durationMs ?? null,
            videoCodec: existing.videoCodec ?? probe.videoCodec ?? null,
            audioCodec: existing.audioCodec ?? probe.audioCodec ?? null,
            width: existing.width ?? probe.width ?? null,
            height: existing.height ?? probe.height ?? null,
          })
          .where(eq(movieFiles.id, existing.id));
      }
      return;
    }

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
          imdbId: match?.imdb_id?.toLowerCase() ?? null,
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

  /** Find a TV show by folder name or TMDB id (stored title may differ after metadata match). */
  private async findTvMediaItem(
    libraryId: number,
    showName: string,
    tmdbId?: number | null,
  ) {
    const byFolderName = await this.db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.libraryId, libraryId),
        eq(mediaItems.type, "tv"),
        eq(mediaItems.title, showName),
      ),
    });
    if (byFolderName) return byFolderName;

    if (tmdbId) {
      return this.db.query.mediaItems.findFirst({
        where: and(
          eq(mediaItems.libraryId, libraryId),
          eq(mediaItems.type, "tv"),
          eq(mediaItems.tmdbId, tmdbId),
        ),
      });
    }

    return undefined;
  }

  /** Merge duplicate TV show rows created when folder name != TMDB title. */
  async dedupeTvShows(libraryId?: number): Promise<number> {
    const conditions = [eq(mediaItems.type, "tv")];
    if (libraryId !== undefined) {
      conditions.push(eq(mediaItems.libraryId, libraryId));
    }

    const items = await this.db.query.mediaItems.findMany({
      where: and(...conditions),
    });

    const groups = new Map<string, (typeof items)[number][]>();
    for (const item of items) {
      const key = item.tmdbId
        ? `${item.libraryId}:tmdb:${item.tmdbId}`
        : `${item.libraryId}:title:${item.title.toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    let merged = 0;

    for (const group of groups.values()) {
      if (group.length <= 1) continue;

      group.sort((a, b) => a.id - b.id);
      const [canonical, ...dupes] = group;

      for (const dupe of dupes) {
        const dupeSeasons = await this.db.query.tvSeasons.findMany({
          where: eq(tvSeasons.mediaItemId, dupe.id),
        });

        for (const season of dupeSeasons) {
          const canonicalSeason = await this.db.query.tvSeasons.findFirst({
            where: and(
              eq(tvSeasons.mediaItemId, canonical.id),
              eq(tvSeasons.seasonNumber, season.seasonNumber),
            ),
          });

          if (canonicalSeason) {
            await this.db
              .update(tvEpisodes)
              .set({ seasonId: canonicalSeason.id })
              .where(eq(tvEpisodes.seasonId, season.id));
            await this.db.delete(tvSeasons).where(eq(tvSeasons.id, season.id));
          } else {
            await this.db
              .update(tvSeasons)
              .set({ mediaItemId: canonical.id })
              .where(eq(tvSeasons.id, season.id));
          }
        }

        await this.db.delete(mediaItems).where(eq(mediaItems.id, dupe.id));
        merged++;
      }
    }

    return merged;
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
    if (existing) {
      if (
        probe &&
        (!existing.videoCodec ||
          !existing.height ||
          existing.durationMs == null ||
          !existing.width)
      ) {
        await this.db
          .update(tvEpisodes)
          .set({
            durationMs: existing.durationMs ?? probe.durationMs ?? null,
            videoCodec: existing.videoCodec ?? probe.videoCodec ?? null,
            audioCodec: existing.audioCodec ?? probe.audioCodec ?? null,
            width: existing.width ?? probe.width ?? null,
            height: existing.height ?? probe.height ?? null,
          })
          .where(eq(tvEpisodes.id, existing.id));
      }
      return;
    }

    const parsed = parseEpisodeFromPath(filePath, lib.path);
    if (!parsed) {
      console.warn(`Could not parse TV episode: ${filePath}`);
      return;
    }

    let mediaItem = await this.findTvMediaItem(lib.id, parsed.showName);

    const { match, confidence } = mediaItem
      ? { match: null, confidence: 0 }
      : await this.metadata.searchTv(parsed.showName);

    if (!mediaItem && match) {
      mediaItem = await this.findTvMediaItem(lib.id, parsed.showName, match.id);
    }

    if (!mediaItem) {
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
        videoCodec: probe?.videoCodec ?? null,
        audioCodec: probe?.audioCodec ?? null,
        width: probe?.width ?? null,
        height: probe?.height ?? null,
        stillPath,
        airDate: episodeMeta?.air_date ?? null,
      })
      .returning();

    await this.subtitles.discoverForEpisode(episode.id, filePath, probe);
    void revalidateMediaPage(mediaItem.id);
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
