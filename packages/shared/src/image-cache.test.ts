import { describe, expect, it } from "vitest";
import { hdImageSizeForCached, parseCachedImageFilename } from "./image-cache.js";

describe("parseCachedImageFilename", () => {
  it("parses w500 poster cache filenames", () => {
    expect(parseCachedImageFilename("w500_abc123.jpg")).toEqual({
      size: "w500",
      imagePath: "/abc123.jpg",
    });
  });

  it("parses nested TMDB paths", () => {
    expect(parseCachedImageFilename("w1280_foo_bar.jpg")).toEqual({
      size: "w1280",
      imagePath: "/foo/bar.jpg",
    });
  });

  it("returns null for unknown patterns", () => {
    expect(parseCachedImageFilename("poster.jpg")).toBeNull();
  });
});

describe("hdImageSizeForCached", () => {
  it("upgrades poster tiers to w780", () => {
    expect(hdImageSizeForCached("w500")).toBe("w780");
  });

  it("upgrades backdrop tiers to w1920", () => {
    expect(hdImageSizeForCached("w1280")).toBe("w1920");
  });

  it("leaves HD tiers unchanged", () => {
    expect(hdImageSizeForCached("w1920")).toBeNull();
  });
});
