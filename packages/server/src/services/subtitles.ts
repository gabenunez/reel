import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { isSubtitleFile } from "@reel/shared";
import type { AppConfig } from "@reel/shared";
import type { DatabaseInstance } from "../db/index.js";
import { subtitles } from "../db/schema.js";
import {
  extractEmbeddedSubtitle,
  type ProbeResult,
} from "../utils/ffmpeg.js";

const LANGUAGE_MAP: Record<string, string> = {
  en: "English",
  eng: "English",
  es: "Spanish",
  spa: "Spanish",
  fr: "French",
  fre: "French",
  de: "German",
  ger: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ru: "Russian",
  zh: "Chinese",
};

function parseSubtitleLanguage(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  const parts = base.split(".");
  if (parts.length >= 2) {
    const langPart = parts[parts.length - 1].toLowerCase();
    return LANGUAGE_MAP[langPart] ?? langPart;
  }
  return "Unknown";
}

export class SubtitleService {
  private cacheDir: string;

  constructor(
    private db: DatabaseInstance,
    config: AppConfig,
  ) {
    this.cacheDir = path.join(config.data_dir, "cache", "subtitles");
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async discoverForMovieFile(
    movieFileId: number,
    filePath: string,
    probe: ProbeResult | null,
  ): Promise<void> {
    await this.db
      .delete(subtitles)
      .where(eq(subtitles.movieFileId, movieFileId));

    await this.discoverExternal(filePath, { movieFileId });
    if (probe) {
      await this.discoverEmbedded(movieFileId, "movie", filePath, probe);
    }
  }

  async discoverForEpisode(
    episodeId: number,
    filePath: string,
    probe: ProbeResult | null,
  ): Promise<void> {
    await this.db.delete(subtitles).where(eq(subtitles.episodeId, episodeId));

    await this.discoverExternal(filePath, { episodeId });
    if (probe) {
      await this.discoverEmbedded(episodeId, "episode", filePath, probe);
    }
  }

  private async discoverExternal(
    videoPath: string,
    ids: { movieFileId?: number; episodeId?: number },
  ): Promise<void> {
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!isSubtitleFile(entry)) continue;

      const entryBase = path.basename(entry, path.extname(entry));
      if (
        entryBase === base ||
        entryBase.startsWith(`${base}.`) ||
        entryBase.startsWith(`${base}_`)
      ) {
        const fullPath = path.join(dir, entry);
        await this.db.insert(subtitles).values({
          movieFileId: ids.movieFileId ?? null,
          episodeId: ids.episodeId ?? null,
          language: parseSubtitleLanguage(entry),
          label: entry,
          source: "external",
          pathOrIndex: fullPath,
        });
      }
    }
  }

  private async discoverEmbedded(
    fileId: number,
    type: "movie" | "episode",
    filePath: string,
    probe: ProbeResult,
  ): Promise<void> {
    for (const stream of probe.subtitleStreams) {
      const cachePath = path.join(
        this.cacheDir,
        `${type}_${fileId}_sub_${stream.index}.vtt`,
      );

      try {
        if (!fs.existsSync(cachePath)) {
          await extractEmbeddedSubtitle(filePath, stream.index, cachePath);
        }

        await this.db.insert(subtitles).values({
          movieFileId: type === "movie" ? fileId : null,
          episodeId: type === "episode" ? fileId : null,
          language: stream.language
            ? (LANGUAGE_MAP[stream.language.toLowerCase()] ?? stream.language)
            : "Embedded",
          label: stream.title ?? `Embedded ${stream.index}`,
          source: "embedded",
          pathOrIndex: cachePath,
        });
      } catch {
        // Skip failed extractions
      }
    }
  }

  convertSrtToVtt(srtContent: string): string {
    const lines = srtContent.replace(/\r\n/g, "\n").split("\n");
    let vtt = "WEBVTT\n\n";
    let i = 0;

    while (i < lines.length) {
      if (/^\d+$/.test(lines[i]?.trim() ?? "")) i++;

      const timeLine = lines[i];
      if (timeLine && timeLine.includes("-->")) {
        vtt += timeLine.replace(/,/g, ".") + "\n";
        i++;
        while (i < lines.length && lines[i].trim() !== "") {
          vtt += lines[i] + "\n";
          i++;
        }
        vtt += "\n";
      }
      i++;
    }

    return vtt;
  }

  async getSubtitleContent(subtitle: typeof subtitles.$inferSelect): Promise<string> {
    const filePath = subtitle.pathOrIndex;

    if (subtitle.source === "embedded" || filePath.endsWith(".vtt")) {
      return fs.readFileSync(filePath, "utf-8");
    }

    const content = fs.readFileSync(filePath, "utf-8");
    if (filePath.endsWith(".srt")) {
      return this.convertSrtToVtt(content);
    }

    return content;
  }
}
