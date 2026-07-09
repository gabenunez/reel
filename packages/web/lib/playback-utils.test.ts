import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamInfo } from "./api.js";
import {
  getPlaybackRestartSeconds,
  resolveInitialStreamQuality,
  resolvePlaybackStartSeconds,
  resolvePlaybackStream,
} from "./playback-utils.js";

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

describe("resolvePlaybackStream", () => {
  it("uses HLS remux for browser-safe codecs in MKV containers", () => {
    expect(
      resolvePlaybackStream(
        "original",
        makeStreamInfo({
          fileName: "movie.mkv",
          mimeType: "video/x-matroska",
          videoCodec: "h264",
          audioCodec: "aac",
          transcodingEnabled: true,
        }),
      ),
    ).toEqual({
      usingHls: true,
      hlsQuality: "remux",
      audioCompatNotice: null,
    });
  });

  it("surfaces a container compatibility message when remuxing is disabled", () => {
    const result = resolvePlaybackStream(
      "original",
      makeStreamInfo({
        fileName: "movie.mkv",
        mimeType: "video/x-matroska",
        videoCodec: "h264",
        audioCodec: "aac",
        transcodingEnabled: false,
      }),
    );

    expect(result.usingHls).toBe(false);
    expect(result.audioCompatNotice).toMatch(/container/i);
  });
});

describe("resolvePlaybackStream with native TV player", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("prefers direct play for MKV on native ExoPlayer", async () => {
    vi.doMock("./android-bridge.js", () => ({
      nativeTvPlayerAvailable: () => true,
    }));
    const { resolvePlaybackStream: resolveNative } = await import("./playback-utils.js");
    expect(
      resolveNative(
        "original",
        makeStreamInfo({
          fileName: "movie.mkv",
          mimeType: "video/x-matroska",
          videoCodec: "hevc",
          audioCodec: "ac3",
          transcodingEnabled: true,
        }),
      ),
    ).toEqual({
      usingHls: false,
      audioCompatNotice: null,
    });
  });
});

describe("resolvePlaybackStartSeconds", () => {
  it("uses saved resume on the first open", () => {
    expect(
      resolvePlaybackStartSeconds({
        streamStartSeconds: null,
        initialResumeSeconds: 1200,
        streamGeneration: 0,
        usingHls: true,
        hlsStartOffset: 0,
        relativeSeconds: 0,
        stableAbsoluteSeconds: 0,
      }),
    ).toEqual({ startSeconds: 1200, consumedExplicitSeek: false });
  });

  it("uses the live playhead on stream restarts instead of stale resume", () => {
    expect(
      resolvePlaybackStartSeconds({
        streamStartSeconds: null,
        initialResumeSeconds: 1200,
        streamGeneration: 2,
        usingHls: true,
        hlsStartOffset: 1200,
        relativeSeconds: 180,
        stableAbsoluteSeconds: 1380,
      }),
    ).toEqual({ startSeconds: 1380, consumedExplicitSeek: false });
  });

  it("prefers an explicit restart position when provided", () => {
    expect(
      resolvePlaybackStartSeconds({
        streamStartSeconds: 420,
        initialResumeSeconds: 1200,
        streamGeneration: 3,
        usingHls: true,
        hlsStartOffset: 1200,
        relativeSeconds: 180,
        stableAbsoluteSeconds: 1380,
      }),
    ).toEqual({ startSeconds: 420, consumedExplicitSeek: true });
  });
});

describe("getPlaybackRestartSeconds", () => {
  it("rejects buffer-edge jumps ahead of the stable playhead", () => {
    expect(
      getPlaybackRestartSeconds({
        usingHls: true,
        hlsStartOffset: 1200,
        relativeSeconds: 420,
        stableAbsoluteSeconds: 1260,
      }),
    ).toBe(1260);
  });

  it("follows the live clock when it is behind the stable playhead", () => {
    expect(
      getPlaybackRestartSeconds({
        usingHls: true,
        hlsStartOffset: 1200,
        relativeSeconds: 60,
        stableAbsoluteSeconds: 1400,
      }),
    ).toBe(1260);
  });
});
