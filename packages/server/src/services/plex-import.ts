import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq, isNotNull } from "drizzle-orm";
import type { DatabaseInstance } from "../db/index.js";
import { mediaItems, movieFiles, tvEpisodes, watchProgress } from "../db/schema.js";

const PLEX_DB_FILENAME = "com.plexapp.plugins.library.db";

/** Plex metadata_type values we care about for playback state. */
const PLEX_METADATA_MOVIE = 1;
const PLEX_METADATA_EPISODE = 4;

export interface PlexWatchEntry {
  metadataType: number;
  title: string;
  filePath: string;
  viewOffsetMs: number;
  viewCount: number;
  durationMs: number | null;
  lastViewedAt: Date | null;
  guid: string;
}

export interface PlexDetectionResult {
  detected: boolean;
  dbPath: string | null;
  candidates: string[];
  warning?: string;
}

export interface PlexImportPreview {
  detected: boolean;
  dbPath: string | null;
  candidates: string[];
  plexEntries: number;
  resumeEntries: number;
  watchedEntries: number;
  matchableEntries: number;
  reelMovieFiles: number;
  reelEpisodes: number;
  warning?: string;
}

export interface PlexImportResult {
  success: boolean;
  dbPath: string;
  imported: number;
  updated: number;
  skipped: number;
  unmatched: number;
  samples: {
    unmatchedTitles: string[];
  };
}

interface ReelMediaTarget {
  itemType: "movie" | "episode";
  itemId: number;
  durationMs: number | null;
}

interface ReelMediaIndex {
  byPath: Map<string, ReelMediaTarget>;
  byBasename: Map<string, ReelMediaTarget[]>;
  movieByTmdb: Map<number, ReelMediaTarget>;
}

export function getPlexDatabaseCandidates(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];

  if (process.platform === "darwin") {
    dirs.push(
      path.join(
        home,
        "Library/Application Support/Plex Media Server/Plug-in Support/Databases",
      ),
      "/Library/Application Support/Plex Media Server/Plug-in Support/Databases",
    );
  } else if (process.platform === "linux") {
    dirs.push(
      "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases",
      path.join(
        home,
        "Library/Application Support/Plex Media Server/Plug-in Support/Databases",
      ),
      path.join(
        process.env.PLEX_HOME ?? home,
        "Library/Application Support/Plex Media Server/Plug-in Support/Databases",
      ),
    );
  } else if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    dirs.push(
      path.join(localAppData, "Plex Media Server/Plug-in Support/Databases"),
    );
  }

  const unique = [...new Set(dirs.map((dir) => path.resolve(dir)))];
  return unique.map((dir) => path.join(dir, PLEX_DB_FILENAME));
}

export function detectPlexLibraryDatabase(customPath?: string): PlexDetectionResult {
  const candidates = customPath
    ? [path.resolve(customPath)]
    : getPlexDatabaseCandidates();

  const existing = candidates.filter((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  if (existing.length === 0) {
    return {
      detected: false,
      dbPath: null,
      candidates,
      warning:
        "No Plex library database found. Install Plex Media Server or provide the path to com.plexapp.plugins.library.db.",
    };
  }

  return {
    detected: true,
    dbPath: existing[0],
    candidates: existing,
  };
}

function normalizeMediaPath(filePath: string): string {
  const resolved = path.resolve(filePath.trim());
  return process.platform === "win32"
    ? resolved.replace(/\\/g, "/").toLowerCase()
    : resolved.replace(/\\/g, "/");
}

function basenameKey(filePath: string): string {
  return path.basename(filePath).toLowerCase();
}

function parsePlexDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
}

function extractTmdbMovieId(guid: string): number | null {
  const match = guid.match(/themoviedb:\/\/movie(?:%3A|:)(\d+)/i);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isNaN(id) ? null : id;
}

function resolvePositionMs(entry: PlexWatchEntry): number | null {
  const duration = entry.durationMs ?? null;

  if (entry.viewOffsetMs > 0) {
    if (duration && duration > 0) {
      return Math.min(entry.viewOffsetMs, Math.floor(duration * 0.995));
    }
    return entry.viewOffsetMs;
  }

  if (entry.viewCount > 0) {
    if (duration && duration > 0) {
      return Math.floor(duration * 0.99);
    }
  }

  return null;
}

function readPlexWatchEntries(dbPath: string): PlexWatchEntry[] {
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata_item_settings'",
      )
      .get() as { name?: string } | undefined;

    if (!tableExists?.name) {
      throw new Error("This file does not look like a Plex library database.");
    }

    const rows = db
      .prepare(
        `
        SELECT
          mi.metadata_type AS metadataType,
          mi.title AS title,
          mi.guid AS guid,
          mi.duration AS duration,
          mp.file AS filePath,
          MAX(COALESCE(mis.view_offset, 0)) AS viewOffset,
          MAX(COALESCE(mis.view_count, 0)) AS viewCount,
          MAX(mis.last_viewed_at) AS lastViewedAt
        FROM metadata_item_settings mis
        INNER JOIN metadata_items mi ON mi.guid = mis.guid
        INNER JOIN media_items med ON med.metadata_item_id = mi.id
        INNER JOIN media_parts mp ON mp.media_item_id = med.id
        WHERE mi.metadata_type IN (${PLEX_METADATA_MOVIE}, ${PLEX_METADATA_EPISODE})
          AND (COALESCE(mis.view_offset, 0) > 0 OR COALESCE(mis.view_count, 0) > 0)
        GROUP BY mi.id, mp.file
        `,
      )
      .all() as Array<{
      metadataType: number;
      title: string;
      guid: string;
      duration: number | null;
      filePath: string;
      viewOffset: number | null;
      viewCount: number | null;
      lastViewedAt: unknown;
    }>;

    return rows
      .filter((row) => row.filePath)
      .map((row) => ({
        metadataType: row.metadataType,
        title: row.title,
        guid: row.guid,
        filePath: row.filePath,
        viewOffsetMs: Math.max(0, row.viewOffset ?? 0),
        viewCount: Math.max(0, row.viewCount ?? 0),
        durationMs: row.duration ?? null,
        lastViewedAt: parsePlexDate(row.lastViewedAt),
      }));
  } finally {
    db.close();
  }
}

async function buildReelMediaIndex(db: DatabaseInstance): Promise<ReelMediaIndex> {
  const byPath = new Map<string, ReelMediaTarget>();
  const byBasename = new Map<string, ReelMediaTarget[]>();
  const movieByTmdb = new Map<number, ReelMediaTarget>();

  const movies = await db.select().from(movieFiles);
  for (const file of movies) {
    const target: ReelMediaTarget = {
      itemType: "movie",
      itemId: file.id,
      durationMs: file.durationMs ?? null,
    };
    byPath.set(normalizeMediaPath(file.filePath), target);

    const base = basenameKey(file.filePath);
    const bucket = byBasename.get(base) ?? [];
    bucket.push(target);
    byBasename.set(base, bucket);
  }

  const episodes = await db.select().from(tvEpisodes);
  for (const episode of episodes) {
    const target: ReelMediaTarget = {
      itemType: "episode",
      itemId: episode.id,
      durationMs: episode.durationMs ?? null,
    };
    byPath.set(normalizeMediaPath(episode.filePath), target);

    const base = basenameKey(episode.filePath);
    const bucket = byBasename.get(base) ?? [];
    bucket.push(target);
    byBasename.set(base, bucket);
  }

  const tmdbMovies = await db
    .select({
      tmdbId: mediaItems.tmdbId,
      fileId: movieFiles.id,
      durationMs: movieFiles.durationMs,
    })
    .from(movieFiles)
    .innerJoin(mediaItems, eq(movieFiles.mediaItemId, mediaItems.id))
    .where(and(eq(mediaItems.type, "movie"), isNotNull(mediaItems.tmdbId)));

  for (const row of tmdbMovies) {
    if (!row.tmdbId || movieByTmdb.has(row.tmdbId)) continue;
    movieByTmdb.set(row.tmdbId, {
      itemType: "movie",
      itemId: row.fileId,
      durationMs: row.durationMs ?? null,
    });
  }

  return { byPath, byBasename, movieByTmdb };
}

function matchPlexEntry(
  entry: PlexWatchEntry,
  index: ReelMediaIndex,
): ReelMediaTarget | null {
  const normalized = normalizeMediaPath(entry.filePath);
  const direct = index.byPath.get(normalized);
  if (direct) return direct;

  const basenameMatches = index.byBasename.get(basenameKey(entry.filePath));
  if (basenameMatches?.length === 1) {
    return basenameMatches[0];
  }

  if (entry.metadataType === PLEX_METADATA_MOVIE) {
    const tmdbId = extractTmdbMovieId(entry.guid);
    if (tmdbId != null) {
      return index.movieByTmdb.get(tmdbId) ?? null;
    }
  }

  return null;
}

function countMatchable(entries: PlexWatchEntry[], index: ReelMediaIndex): number {
  let count = 0;
  for (const entry of entries) {
    if (matchPlexEntry(entry, index)) count += 1;
  }
  return count;
}

export async function previewPlexImport(
  db: DatabaseInstance,
  customPath?: string,
): Promise<PlexImportPreview> {
  const detection = detectPlexLibraryDatabase(customPath);
  if (!detection.detected || !detection.dbPath) {
    return {
      detected: false,
      dbPath: null,
      candidates: detection.candidates,
      plexEntries: 0,
      resumeEntries: 0,
      watchedEntries: 0,
      matchableEntries: 0,
      reelMovieFiles: 0,
      reelEpisodes: 0,
      warning: detection.warning,
    };
  }

  const entries = readPlexWatchEntries(detection.dbPath);
  const index = await buildReelMediaIndex(db);
  const movies = await db.select().from(movieFiles);
  const episodes = await db.select().from(tvEpisodes);

  return {
    detected: true,
    dbPath: detection.dbPath,
    candidates: detection.candidates,
    plexEntries: entries.length,
    resumeEntries: entries.filter((entry) => entry.viewOffsetMs > 0).length,
    watchedEntries: entries.filter(
      (entry) => entry.viewCount > 0 && entry.viewOffsetMs <= 0,
    ).length,
    matchableEntries: countMatchable(entries, index),
    reelMovieFiles: movies.length,
    reelEpisodes: episodes.length,
    warning:
      "Stop Plex Media Server before importing for the most consistent read. Reel only updates progress for files already in your libraries.",
  };
}

export async function importPlexWatchProgress(
  db: DatabaseInstance,
  options: { plexDbPath?: string; overwrite?: boolean } = {},
): Promise<PlexImportResult> {
  const detection = detectPlexLibraryDatabase(options.plexDbPath);
  if (!detection.detected || !detection.dbPath) {
    throw new Error(detection.warning ?? "Plex library database not found.");
  }

  const entries = readPlexWatchEntries(detection.dbPath);
  const index = await buildReelMediaIndex(db);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let unmatched = 0;
  const unmatchedTitles: string[] = [];

  for (const entry of entries) {
    const positionMs = resolvePositionMs(entry);
    if (positionMs == null || positionMs <= 0) {
      skipped += 1;
      continue;
    }

    const target = matchPlexEntry(entry, index);
    if (!target) {
      unmatched += 1;
      if (unmatchedTitles.length < 8) unmatchedTitles.push(entry.title);
      continue;
    }

    const durationMs = target.durationMs ?? entry.durationMs ?? null;
    if (durationMs && durationMs > 0) {
      const percent = positionMs / durationMs;
      if (percent < 0.01) {
        skipped += 1;
        continue;
      }
    }

    const existing = await db.query.watchProgress.findFirst({
      where: and(
        eq(watchProgress.itemType, target.itemType),
        eq(watchProgress.itemId, target.itemId),
      ),
    });

    const plexUpdatedAt = entry.lastViewedAt ?? new Date();

    if (existing) {
      const keepExisting =
        !options.overwrite &&
        (existing.updatedAt.getTime() > plexUpdatedAt.getTime() ||
          existing.positionMs >= positionMs);
      if (keepExisting) {
        skipped += 1;
        continue;
      }

      await db
        .update(watchProgress)
        .set({
          positionMs,
          durationMs,
          updatedAt: plexUpdatedAt,
        })
        .where(eq(watchProgress.id, existing.id));
      updated += 1;
      continue;
    }

    await db.insert(watchProgress).values({
      itemType: target.itemType,
      itemId: target.itemId,
      positionMs,
      durationMs,
      updatedAt: plexUpdatedAt,
    });
    imported += 1;
  }

  return {
    success: true,
    dbPath: detection.dbPath,
    imported,
    updated,
    skipped,
    unmatched,
    samples: { unmatchedTitles },
  };
}
