import type { ParsedMovie } from "../types.js";
import {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  NON_VIDEO_EXTENSIONS,
} from "../constants.js";

const YEAR_REGEX = /\b(19|20)\d{2}\b/;
const QUALITY_TAGS =
  /\b(720p|1080p|2160p|4k|8k|bluray|blu-ray|bdrip|brrip|webrip|web-dl|hdtv|dvdrip|x264|x265|hevc|aac|dts|remux)\b/gi;
const GROUP_TAGS = /[\[\(][^\]\)]+[\]\)]/g;
const SEPARATORS = /[._\-+]+/g;

function cleanTitle(raw: string): string {
  return raw
    .replace(GROUP_TAGS, " ")
    .replace(QUALITY_TAGS, " ")
    .replace(SEPARATORS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return "";
  return filename.slice(dot).toLowerCase();
}

export function parseMovieFilename(filename: string): ParsedMovie {
  const base = filename.replace(/\.[^.]+$/, "");
  const yearMatch = base.match(YEAR_REGEX);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined;

  let titlePart = base;
  if (yearMatch?.index !== undefined) {
    titlePart = base.slice(0, yearMatch.index);
  }

  const title = cleanTitle(titlePart) || cleanTitle(base) || base;

  return {
    title,
    year,
    rawFilename: filename,
  };
}

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(getFileExtension(filename));
}

export function isSubtitleFile(filename: string): boolean {
  return SUBTITLE_EXTENSIONS.has(getFileExtension(filename));
}

/** True if this file should be skipped when probing unknown extensions. */
export function isExcludedFromVideoProbe(filename: string): boolean {
  const ext = getFileExtension(filename);
  if (!ext) return false;
  return NON_VIDEO_EXTENSIONS.has(ext);
}

/** True if an unknown file might be video and is worth probing with FFprobe. */
export function isUnknownVideoCandidate(
  filename: string,
  fileSizeBytes: number,
  minSizeBytes = 512 * 1024,
): boolean {
  if (isVideoFile(filename) || isSubtitleFile(filename)) return false;
  if (isExcludedFromVideoProbe(filename)) return false;
  if (fileSizeBytes < minSizeBytes) return false;
  return true;
}
