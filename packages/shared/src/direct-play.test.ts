import { describe, expect, it } from "vitest";
import {
  containerPrefersHlsRemux,
  isBrowserDirectPlayAudioSupported,
  isBrowserDirectPlayVideoSupported,
  isHlsVideoCopySupported,
  isNativeTvDirectPlayAudioSupported,
  isNativeTvDirectPlayVideoSupported,
  normalizeCodecName,
  pickTranscodeQualityForPlayback,
  resolveNativeTvPlaybackMode,
  resolveOriginalPlaybackMode,
} from "./direct-play.js";

describe("normalizeCodecName", () => {
  it("normalizes common codec strings", () => {
    expect(normalizeCodecName("libx264")).toBe("x264");
    expect(normalizeCodecName("AVC1")).toBe("h264");
    expect(normalizeCodecName("hevc")).toBe("hevc");
    expect(normalizeCodecName("E-AC-3")).toBe("eac3");
    expect(normalizeCodecName("mp4a.40.2")).toBe("mp4a");
  });

  it("returns null for empty values", () => {
    expect(normalizeCodecName(null)).toBeNull();
    expect(normalizeCodecName("  ")).toBeNull();
  });
});

describe("browser direct play support", () => {
  it("supports AAC/H.264 in browsers", () => {
    expect(isBrowserDirectPlayAudioSupported("aac")).toBe(true);
    expect(isBrowserDirectPlayVideoSupported("h264")).toBe(true);
  });

  it("does not direct-play AC3 or HEVC in browsers", () => {
    expect(isBrowserDirectPlayAudioSupported("ac3")).toBe(false);
    expect(isBrowserDirectPlayVideoSupported("hevc")).toBe(false);
  });
});

describe("native TV direct play support", () => {
  it("supports common TV codecs", () => {
    expect(isNativeTvDirectPlayAudioSupported("ac3")).toBe(true);
    expect(isNativeTvDirectPlayVideoSupported("hevc")).toBe(true);
    expect(isNativeTvDirectPlayVideoSupported("vp9")).toBe(true);
  });
});

describe("resolveOriginalPlaybackMode", () => {
  it("direct-plays browser-safe codecs", () => {
    expect(
      resolveOriginalPlaybackMode({
        audioCodec: "aac",
        videoCodec: "h264",
        transcodingEnabled: true,
      }),
    ).toBe("direct");
  });

  it("remuxes unsupported audio with H.264 when transcoding is enabled", () => {
    expect(
      resolveOriginalPlaybackMode({
        audioCodec: "ac3",
        videoCodec: "h264",
        transcodingEnabled: true,
      }),
    ).toBe("remux");
  });

  it("returns unsupported when transcoding is disabled", () => {
    expect(
      resolveOriginalPlaybackMode({
        audioCodec: "ac3",
        videoCodec: "h264",
        transcodingEnabled: false,
      }),
    ).toBe("unsupported");
  });
});

describe("resolveNativeTvPlaybackMode", () => {
  it("direct-plays HEVC + AC3 on TV", () => {
    expect(
      resolveNativeTvPlaybackMode({
        audioCodec: "ac3",
        videoCodec: "hevc",
        transcodingEnabled: true,
      }),
    ).toBe("direct");
  });

  it("remuxes unsupported audio with H.264 when transcoding is enabled", () => {
    expect(
      resolveNativeTvPlaybackMode({
        audioCodec: "opus",
        videoCodec: "h264",
        transcodingEnabled: true,
      }),
    ).toBe("remux");
  });
});

describe("isHlsVideoCopySupported", () => {
  it("allows H.264 and HEVC copy", () => {
    expect(isHlsVideoCopySupported("h264")).toBe(true);
    expect(isHlsVideoCopySupported("hevc")).toBe(true);
    expect(isHlsVideoCopySupported("vp9")).toBe(false);
  });
});

describe("containerPrefersHlsRemux", () => {
  it("prefers remux for MKV and WebM", () => {
    expect(containerPrefersHlsRemux("movie.mkv")).toBe(true);
    expect(containerPrefersHlsRemux("movie.webm")).toBe(true);
    expect(containerPrefersHlsRemux("movie.mp4")).toBe(false);
  });
});

describe("pickTranscodeQualityForPlayback", () => {
  it("picks a tier close to widescreen 1080p sources", () => {
    expect(
      pickTranscodeQualityForPlayback(
        ["original", "480p", "720p", "1080p"],
        800,
        1920,
      ),
    ).toBe("1080p");
  });

  it("falls back when preferred tier is unavailable", () => {
    expect(
      pickTranscodeQualityForPlayback(["original", "480p", "720p"], 800, 1920),
    ).toBe("720p");
  });
});
