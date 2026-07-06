import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamInfo } from "./api.js";
import { resolveInitialStreamQuality } from "./playback-utils.js";

vi.mock("./android-bridge.js", () => ({
  nativeTvPlayerAvailable: () => false,
}));

vi.mock("./tv-mode-detect.js", () => ({
  isTvClient: () => false,
}));

function makeStreamInfo(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return {
    id: 1,
    type: "movie",
    mimeType: "video/x-matroska",
    fileSize: 5_000_000_000,
    fileName: "movie.mkv",
    filePath: "/media/movie.mkv",
    isSymlink: false,
    height: 800,
    width: 1920,
    durationMs: 7_200_000,
    videoCodec: "hevc",
    audioCodec: "ac3",
    availableQualities: ["original", "480p", "720p", "1080p"],
    transcodingEnabled: true,
    directPlayAudioSupported: false,
    ...overrides,
  };
}

describe("resolveInitialStreamQuality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always starts at original when transcoding is enabled", () => {
    expect(resolveInitialStreamQuality(makeStreamInfo())).toEqual({
      quality: "original",
      error: null,
    });
  });

  it("keeps original but surfaces an error when transcoding is disabled", () => {
    const result = resolveInitialStreamQuality(
      makeStreamInfo({ transcodingEnabled: false }),
    );
    expect(result.quality).toBe("original");
    expect(result.error).toMatch(/transcoding/i);
  });

  it("does not auto-downgrade browser-incompatible codecs", () => {
    const result = resolveInitialStreamQuality(
      makeStreamInfo({
        videoCodec: "hevc",
        audioCodec: "ac3",
        transcodingEnabled: true,
      }),
    );
    expect(result).toEqual({ quality: "original", error: null });
  });
});
