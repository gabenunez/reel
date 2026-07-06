import { describe, expect, it } from "vitest";
import {
  effectiveTranscodeHeight,
  getAvailableQualities,
  getSourceResolutionTier,
  is4KSource,
  parseHlsQuality,
  parseTranscodeQuality,
  qualityLabel,
  tierToTranscodeQuality,
} from "./stream-quality.js";

describe("getSourceResolutionTier", () => {
  it("classifies widescreen 1080p by width when height is letterboxed", () => {
    expect(getSourceResolutionTier(800, 1920)).toBe(1080);
    expect(getSourceResolutionTier(804, 1920)).toBe(1080);
  });

  it("classifies true 720p sources", () => {
    expect(getSourceResolutionTier(720, 1280)).toBe(720);
    expect(getSourceResolutionTier(536, 1280)).toBe(720);
  });

  it("classifies 4K by height or width", () => {
    expect(getSourceResolutionTier(2160, 3840)).toBe(2160);
    expect(getSourceResolutionTier(1600, 3840)).toBe(2160);
  });

  it("classifies SD content", () => {
    expect(getSourceResolutionTier(480, 640)).toBe(480);
  });
});

describe("getAvailableQualities", () => {
  it("includes 1080p for letterboxed Blu-ray rips", () => {
    expect(getAvailableQualities(800, 1920)).toEqual([
      "original",
      "480p",
      "720p",
      "1080p",
    ]);
  });

  it("includes 2160p only for 4K sources", () => {
    expect(getAvailableQualities(2160, 3840)).toContain("2160p");
    expect(getAvailableQualities(1080, 1920)).not.toContain("2160p");
  });

  it("offers default transcode tiers when dimensions are unknown", () => {
    expect(getAvailableQualities(null, null)).toEqual([
      "original",
      "480p",
      "720p",
      "1080p",
    ]);
  });
});

describe("qualityLabel", () => {
  it("labels original quality using width-aware tiers", () => {
    expect(qualityLabel("original", 800, 1920)).toBe("Original (1080p)");
    expect(qualityLabel("original", 720, 1280)).toBe("Original (720p)");
    expect(qualityLabel("1080p", 800, 1920)).toBe("1080p");
  });
});

describe("effectiveTranscodeHeight", () => {
  it("never upscales above source height", () => {
    expect(effectiveTranscodeHeight("1080p", 800)).toBe(800);
    expect(effectiveTranscodeHeight("720p", 480)).toBe(480);
  });

  it("uses preset max when source height is missing", () => {
    expect(effectiveTranscodeHeight("720p", null)).toBe(720);
  });
});

describe("parseTranscodeQuality", () => {
  it("accepts known tiers and rejects unknown values", () => {
    expect(parseTranscodeQuality("720p")).toBe("720p");
    expect(parseTranscodeQuality("remux")).toBeNull();
    expect(parseHlsQuality("remux")).toBe("remux");
  });
});

describe("tierToTranscodeQuality", () => {
  it("maps numeric tiers to stream qualities", () => {
    expect(tierToTranscodeQuality(1080)).toBe("1080p");
    expect(tierToTranscodeQuality(2160)).toBe("2160p");
  });
});

describe("is4KSource", () => {
  it("detects ultrawide 4K widths", () => {
    expect(is4KSource(1600, 3840)).toBe(true);
    expect(is4KSource(1080, 1920)).toBe(false);
  });
});
