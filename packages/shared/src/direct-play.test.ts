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

  it("remuxes browser-safe codecs in non-progressive-friendly containers", () => {
    expect(
      resolveOriginalPlaybackMode({
        audioCodec: "aac",
        videoCodec: "h264",
        transcodingEnabled: true,
        fileName: "movie.mkv",
      }),
    ).toBe("remux");
  });

  it("marks non-progressive-friendly containers unsupported when remuxing is disabled", () => {
    expect(
      resolveOriginalPlaybackMode({
        audioCodec: "aac",
        videoCodec: "h264",
        transcodingEnabled: false,
        fileName: "movie.mkv",
      }),
    ).toBe("unsupported");
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

  it("direct-plays Dolby Vision even when the audio track is not directly supported", () => {
    // opus is not in the native-TV direct-play audio set, so without the DV
    // rule this would remux — which strips the DV layer. DV forces direct.
    expect(
      resolveNativeTvPlaybackMode({
        audioCodec: "opus",
        videoCodec: "hevc",
        transcodingEnabled: true,
        dolbyVision: true,
      }),
    ).toBe("direct");
  });

  it("still direct-plays Dolby Vision with directly-supported audio", () => {
    expect(
      resolveNativeTvPlaybackMode({
        audioCodec: "eac3",
        videoCodec: "hevc",
        transcodingEnabled: true,
        dolbyVision: true,
      }),
    ).toBe("direct");
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

  it("keeps source-matched 2160p for 4K originals when available", () => {
    expect(
      pickTranscodeQualityForPlayback(
        ["original", "480p", "720p", "1080p", "2160p"],
        1604,
        3840,
      ),
    ).toBe("2160p");
  });
});
