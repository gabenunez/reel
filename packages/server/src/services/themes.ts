import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { THEME_FILENAMES, resolveShowDirectory } from "@reel/shared";
import type { ConfigManager } from "../config.js";
import type { DatabaseInstance } from "../db/index.js";
import {
  libraries,
  mediaItems,
  movieFiles,
  tvEpisodes,
  tvSeasons,
  type MediaItem,
} from "../db/schema.js";
import type { MetadataService } from "./metadata.js";

const THEME_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function findThemeInDirectory(dir: string): string | null {
  for (const name of THEME_FILENAMES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export class ThemeService {
  private cacheDir: string;

  constructor(
    private db: DatabaseInstance,
    private configManager: ConfigManager,
    private metadata: MetadataService,
  ) {
    this.cacheDir = path.join(configManager.get().data_dir, "cache", "themes");
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  mimeTypeForPath(filePath: string): string {
    return THEME_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "audio/mpeg";
  }

  hasThemeMusic(item: Pick<MediaItem, "themePath">): boolean {
    return Boolean(item.themePath && fs.existsSync(item.themePath));
  }

  async syncForMediaItem(
    item: Pick<MediaItem, "id" | "libraryId" | "type" | "tmdbId" | "themePath">,
  ): Promise<string | null> {
    if (item.themePath && fs.existsSync(item.themePath)) {
      return item.themePath;
    }

    const localPath = await this.discoverLocalTheme(item);
    if (localPath) {
      await this.saveThemePath(item.id, localPath);
      return localPath;
    }

    if (item.type === "tv" && item.tmdbId) {
      const remotePath = await this.fetchFanartTvTheme(item.tmdbId);
      if (remotePath) {
        await this.saveThemePath(item.id, remotePath);
        return remotePath;
      }
    }

    if (item.themePath) {
      await this.db
        .update(mediaItems)
        .set({ themePath: null, updatedAt: new Date() })
        .where(eq(mediaItems.id, item.id));
    }

    return null;
  }

  async syncThemesForLibrary(libraryId: number): Promise<void> {
    const items = await this.db.query.mediaItems.findMany({
      where: eq(mediaItems.libraryId, libraryId),
    });

    for (const item of items) {
      try {
        await this.syncForMediaItem(item);
      } catch (err) {
        console.warn(
          `Theme sync failed for media ${item.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  private async saveThemePath(mediaItemId: number, themePath: string): Promise<void> {
    await this.db
      .update(mediaItems)
      .set({ themePath, updatedAt: new Date() })
      .where(eq(mediaItems.id, mediaItemId));
  }

  private async discoverLocalTheme(
    item: Pick<MediaItem, "id" | "libraryId" | "type">,
  ): Promise<string | null> {
    const library = await this.db.query.libraries.findFirst({
      where: eq(libraries.id, item.libraryId),
    });
    if (!library) return null;

    if (item.type === "movie") {
      const file = await this.db.query.movieFiles.findFirst({
        where: eq(movieFiles.mediaItemId, item.id),
      });
      if (!file) return null;
      return findThemeInDirectory(path.dirname(file.filePath));
    }

    const seasons = await this.db.query.tvSeasons.findMany({
      where: eq(tvSeasons.mediaItemId, item.id),
    });

    for (const season of seasons) {
      const episode = await this.db.query.tvEpisodes.findFirst({
        where: eq(tvEpisodes.seasonId, season.id),
      });
      if (!episode) continue;

      const showDir = resolveShowDirectory(episode.filePath, library.path);
      if (!showDir) continue;

      const themePath = findThemeInDirectory(showDir);
      if (themePath) return themePath;
    }

    return null;
  }

  private async fetchFanartTvTheme(tmdbId: number): Promise<string | null> {
    const apiKey = this.configManager.get().metadata.fanart_api_key?.trim();
    if (!apiKey) return null;

    const tvdbId = await this.metadata.getTvdbId(tmdbId);
    if (!tvdbId) return null;

    const cachePath = path.join(this.cacheDir, `tv_${tvdbId}.mp3`);
    if (fs.existsSync(cachePath)) {
      return cachePath;
    }

    const res = await fetch(
      `https://webservice.fanart.tv/v3/tv/${tvdbId}?api_key=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" } },
    );

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      musictheme?: Array<{ url?: string }>;
      tvtheme?: Array<{ url?: string }>;
    };

    const themeUrl = data.musictheme?.[0]?.url ?? data.tvtheme?.[0]?.url;
    if (!themeUrl) return null;

    const download = await fetch(themeUrl);
    if (!download.ok || !download.body) return null;

    const buffer = Buffer.from(await download.arrayBuffer());
    fs.writeFileSync(cachePath, buffer);
    return cachePath;
  }
}
