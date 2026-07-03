import path from "node:path";
import type { ParsedEpisode } from "../types.js";
import { isVideoFile } from "./movie.js";

const EPISODE_PATTERNS = [
  /\b[Ss](\d{1,2})[Ee](\d{1,3})\b/,
  /\b(\d{1,2})[xX](\d{1,3})\b/,
  /\b[Ss]eason\s*(\d{1,2}).*?[Ee]pisode\s*(\d{1,3})\b/i,
  /\b[Ee]p(?:isode)?\.?\s*(\d{1,3})\b/,
];

const SEASON_FOLDER_PATTERN = /[Ss]eason[\s._-]*(\d{1,2})/i;

function cleanShowName(name: string): string {
  return name
    .replace(/[\[\(][^\]\)]+[\]\)]/g, " ")
    .replace(/[._\-+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEpisodeFromPath(
  filePath: string,
  libraryRoot: string,
): ParsedEpisode | null {
  const relative = filePath.startsWith(libraryRoot)
    ? filePath.slice(libraryRoot.length).replace(/^[/\\]+/, "")
    : filePath;

  const parts = relative.split(/[/\\]/);
  if (parts.length === 0) return null;

  const filename = parts[parts.length - 1];
  if (!isVideoFile(filename)) return null;

  let season: number | undefined;
  let episode: number | undefined;

  for (const part of parts) {
    const seasonMatch = part.match(SEASON_FOLDER_PATTERN);
    if (seasonMatch) {
      season = parseInt(seasonMatch[1], 10);
      break;
    }
  }

  for (const pattern of EPISODE_PATTERNS) {
    const match = filename.match(pattern);
    if (match) {
      if (match.length >= 3 && match[1] && match[2]) {
        season = season ?? parseInt(match[1], 10);
        episode = parseInt(match[2], 10);
      } else if (match.length >= 2 && match[1]) {
        episode = parseInt(match[1], 10);
      }
      break;
    }
  }

  if (episode === undefined) return null;

  const showName =
    parts.length >= 2
      ? cleanShowName(parts[0])
      : cleanShowName(filename.replace(/\.[^.]+$/, ""));

  if (!showName) return null;

  return {
    showName,
    season: season ?? 1,
    episode,
    rawFilename: filename,
    filePath,
  };
}

export function extractShowFolder(filePath: string, libraryRoot: string): string {
  const relative = filePath.startsWith(libraryRoot)
    ? filePath.slice(libraryRoot.length).replace(/^[/\\]+/, "")
    : filePath;
  const parts = relative.split(/[/\\]/);
  return parts.length >= 2 ? cleanShowName(parts[0]) : cleanShowName(parts[0] ?? "");
}

/** Absolute path to the TV show root directory (first folder under the library). */
export function resolveShowDirectory(
  filePath: string,
  libraryRoot: string,
): string | null {
  const relative = filePath.startsWith(libraryRoot)
    ? filePath.slice(libraryRoot.length).replace(/^[/\\]+/, "")
    : filePath;
  const parts = relative.split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) return null;
  return path.join(libraryRoot, parts[0]);
}
