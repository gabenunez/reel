import { describe, expect, it } from "vitest";
import {
  getFileExtension,
  isExcludedFromVideoProbe,
  isUnknownVideoCandidate,
  isVideoFile,
  parseMovieFilename,
} from "./parsers/movie.js";
import {
  extractShowFolder,
  parseEpisodeFromPath,
  resolveShowDirectory,
} from "./parsers/tv.js";

describe("parseMovieFilename", () => {
  it("extracts title and year from common release names", () => {
    expect(parseMovieFilename("The Matrix (1999).mkv")).toEqual({
      title: "The Matrix",
      year: 1999,
      rawFilename: "The Matrix (1999).mkv",
    });
  });

  it("strips quality tags from the title", () => {
    expect(parseMovieFilename("Dune.2021.2160p.BluRay.x265.mkv")).toEqual({
      title: "Dune",
      year: 2021,
      rawFilename: "Dune.2021.2160p.BluRay.x265.mkv",
    });
  });
});

describe("file type helpers", () => {
  it("detects video and excluded extensions", () => {
    expect(isVideoFile("movie.mkv")).toBe(true);
    expect(getFileExtension("movie.MKV")).toBe(".mkv");
    expect(isExcludedFromVideoProbe("poster.jpg")).toBe(true);
  });

  it("flags large unknown files as probe candidates", () => {
    expect(isUnknownVideoCandidate("sample.dat", 2 * 1024 * 1024)).toBe(true);
    expect(isUnknownVideoCandidate("sample.dat", 1000)).toBe(false);
    expect(isUnknownVideoCandidate("sample.nfo", 2 * 1024 * 1024)).toBe(false);
  });
});

describe("parseEpisodeFromPath", () => {
  const libraryRoot = "/media/tv";

  it("parses standard SxxExx filenames", () => {
    expect(
      parseEpisodeFromPath(
        "/media/tv/Breaking Bad/Season 01/Breaking.Bad.S01E02.mkv",
        libraryRoot,
      ),
    ).toEqual({
      showName: "Breaking Bad",
      season: 1,
      episode: 2,
      rawFilename: "Breaking.Bad.S01E02.mkv",
      filePath: "/media/tv/Breaking Bad/Season 01/Breaking.Bad.S01E02.mkv",
    });
  });

  it("returns null when no episode number is found", () => {
    expect(
      parseEpisodeFromPath("/media/tv/Breaking Bad/Season 01/pilot.mkv", libraryRoot),
    ).toBeNull();
  });
});

describe("show path helpers", () => {
  const libraryRoot = "/media/tv";

  it("extracts show folder names", () => {
    expect(
      extractShowFolder(
        "/media/tv/The Office/Season 2/The.Office.S02E01.mkv",
        libraryRoot,
      ),
    ).toBe("The Office");
  });

  it("resolves show directory paths", () => {
    expect(
      resolveShowDirectory(
        "/media/tv/The Office/Season 2/The.Office.S02E01.mkv",
        libraryRoot,
      ),
    ).toBe("/media/tv/The Office");
  });
});
