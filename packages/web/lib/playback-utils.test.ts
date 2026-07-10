import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamInfo } from "./api.js";
import {
  getPlaybackRestartSeconds,
  getContiguousBufferedAhead,
  getScrubberBufferedRanges,
  isSpuriousHlsEnded,
  nextStableAbsoluteSeconds,
  playlistM3u8HasEndList,
  RECOVERY_FORGIVE_PROGRESS_SECONDS,
  resolveRecoveryBudget,
  resolveSpuriousRecovery,
  type SpuriousRecoveryState,
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

describe("isSpuriousHlsEnded", () => {
  it("detects premature ended events during ongoing transcodes", () => {
    expect(
      isSpuriousHlsEnded({
        usingHls: true,
        relativeSeconds: 24,
        hlsStartOffset: 1200,
        sourceDurationSeconds: 7200,
      }),
    ).toBe(true);
  });

  it("allows ended near the real file end", () => {
    expect(
      isSpuriousHlsEnded({
        usingHls: true,
        relativeSeconds: 5998,
        hlsStartOffset: 1200,
        sourceDurationSeconds: 7200,
      }),
    ).toBe(false);
  });

  it("uses playlist duration when source duration is missing", () => {
    expect(
      isSpuriousHlsEnded({
        usingHls: true,
        relativeSeconds: 24,
        hlsStartOffset: 0,
        sourceDurationSeconds: 0,
        playlistRelativeSeconds: 30,
      }),
    ).toBe(true);
  });
});

describe("getScrubberBufferedRanges", () => {
  it("returns one contiguous bar from the playhead and hides disconnected islands", () => {
    expect(
      getScrubberBufferedRanges(
        [
          { start: 0, end: 24 },
          { start: 48, end: 54 },
          { start: 72, end: 78 },
        ],
        20,
      ),
    ).toEqual([{ start: 20, end: 24 }]);
  });

  it("merges small gaps ahead of the playhead", () => {
    expect(
      getScrubberBufferedRanges(
        [
          { start: 0, end: 30 },
          { start: 33, end: 60 },
        ],
        25,
      ),
    ).toEqual([{ start: 25, end: 60 }]);
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
    ).toBe(1200);
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
    ).toBe(1380);
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
    ).toBe(420);
  });

  it("uses an explicit restart position on the first quality change", () => {
    expect(
      resolvePlaybackStartSeconds({
        streamStartSeconds: 2100,
        initialResumeSeconds: 1200,
        streamGeneration: 0,
        usingHls: true,
        hlsStartOffset: 0,
        relativeSeconds: 2100,
        stableAbsoluteSeconds: 2100,
      }),
    ).toBe(2100);
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

describe("nextStableAbsoluteSeconds", () => {
  it("tracks normal small forward progress exactly", () => {
    expect(nextStableAbsoluteSeconds(100, 100.25)).toBe(100.25);
  });

  it("tolerates a small backward correction", () => {
    expect(nextStableAbsoluteSeconds(100, 99.2)).toBe(99.2);
  });

  it("ignores a small backward blip below the tolerance", () => {
    expect(nextStableAbsoluteSeconds(100, 98)).toBe(100);
  });

  it("clamps a sudden large forward spike instead of adopting it outright", () => {
    // A one-tick jump of +20s looks like an HLS buffer-hole nudge or a
    // segment renumbering artifact, not real playback progress.
    expect(nextStableAbsoluteSeconds(100, 120)).toBe(103);
  });

  it("catches up to a sustained real jump within a few samples", () => {
    let stable = 100;
    for (let i = 0; i < 7; i++) {
      stable = nextStableAbsoluteSeconds(stable, 120);
    }
    expect(stable).toBe(120);
  });
});

describe("playlistM3u8HasEndList", () => {
  it("detects ENDLIST in a media playlist", () => {
    expect(
      playlistM3u8HasEndList(
        "#EXTM3U\n#EXTINF:6.0,\nsegment_000.ts\n#EXT-X-ENDLIST\n",
      ),
    ).toBe(true);
  });

  it("returns false for a growing playlist without ENDLIST", () => {
    expect(
      playlistM3u8HasEndList("#EXTM3U\n#EXTINF:6.0,\nsegment_000.ts\n"),
    ).toBe(false);
  });
});

describe("getContiguousBufferedAhead", () => {
  it("ignores disconnected prefetch islands ahead of the playhead", () => {
    const video = {
      currentTime: 20,
      buffered: {
        length: 2,
        start: (i: number) => (i === 0 ? 0 : 48),
        end: (i: number) => (i === 0 ? 24 : 54),
      },
    } as HTMLVideoElement;

    expect(getContiguousBufferedAhead(video)).toBeCloseTo(4, 1);
  });
});

describe("resolveRecoveryBudget", () => {
  const base = {
    spentBudget: 0,
    maxBudget: 4,
    currentPositionSeconds: 0,
    positionAtLastRecoverySeconds: 0,
  };

  it("allows the first recovery and counts it", () => {
    expect(resolveRecoveryBudget(base)).toEqual({
      allowed: true,
      nextSpentBudget: 1,
    });
  });

  it("blocks recovery once the budget is exhausted without healthy playback", () => {
    expect(
      resolveRecoveryBudget({
        ...base,
        spentBudget: 4,
        currentPositionSeconds: 120,
        positionAtLastRecoverySeconds: 119,
      }),
    ).toEqual({ allowed: false, nextSpentBudget: 4 });
  });

  it("forgives the budget after sustained playback and re-allows recovery", () => {
    const progressed =
      100 + RECOVERY_FORGIVE_PROGRESS_SECONDS;
    expect(
      resolveRecoveryBudget({
        ...base,
        spentBudget: 4,
        currentPositionSeconds: progressed,
        positionAtLastRecoverySeconds: 100,
      }),
    ).toEqual({ allowed: true, nextSpentBudget: 1 });
  });

  it("does not forgive when progress is below the threshold", () => {
    expect(
      resolveRecoveryBudget({
        ...base,
        spentBudget: 3,
        currentPositionSeconds: 100 + RECOVERY_FORGIVE_PROGRESS_SECONDS - 1,
        positionAtLastRecoverySeconds: 100,
      }),
    ).toEqual({ allowed: true, nextSpentBudget: 4 });
  });

  it("treats a backward jump (seek/reset) as not healed", () => {
    expect(
      resolveRecoveryBudget({
        ...base,
        spentBudget: 4,
        currentPositionSeconds: 10,
        positionAtLastRecoverySeconds: 500,
      }),
    ).toEqual({ allowed: false, nextSpentBudget: 4 });
  });
});

describe("resolveSpuriousRecovery", () => {
  const fresh: SpuriousRecoveryState = {
    attempts: 0,
    lastEndedAtMs: 0,
    anchorSeconds: 0,
  };

  it("recovers in place on the first spurious ended", () => {
    const result = resolveSpuriousRecovery({
      state: fresh,
      nowMs: 1_000,
      relativeSeconds: 6,
    });
    expect(result.action).toBe("recover");
    expect(result.next.attempts).toBe(1);
    expect(result.next.anchorSeconds).toBe(6);
  });

  it("coalesces rapid repeats without spending the budget", () => {
    // Five rapid repeats (250ms apart) at the same wall stay at 1 attempt.
    let state: SpuriousRecoveryState = fresh;
    let now = 1_000;
    for (let i = 0; i < 5; i++) {
      const result = resolveSpuriousRecovery({
        state,
        nowMs: now,
        relativeSeconds: 6,
      });
      expect(result.action).toBe("recover");
      state = result.next;
      now += 250;
    }
    expect(state.attempts).toBe(1);
  });

  it("restarts only after repeated recoveries with no forward progress", () => {
    let state: SpuriousRecoveryState = fresh;
    let now = 1_000;
    let action = "recover";
    // Space attempts > coalesce window apart, no progress (same position).
    for (let i = 0; i < 10 && action === "recover"; i++) {
      const result = resolveSpuriousRecovery({
        state,
        nowMs: now,
        relativeSeconds: 6,
      });
      action = result.action;
      state = result.next;
      now += 6_000;
    }
    expect(action).toBe("restart");
  });

  it("resets the budget after sustained forward progress (rate limiter)", () => {
    let state: SpuriousRecoveryState = {
      attempts: 4,
      lastEndedAtMs: 1_000,
      anchorSeconds: 6,
    };
    // Next spurious ended happens 20s later at a much later position.
    const result = resolveSpuriousRecovery({
      state,
      nowMs: 30_000,
      relativeSeconds: 6 + RECOVERY_FORGIVE_PROGRESS_SECONDS + 100,
    });
    expect(result.action).toBe("recover");
    // Progress cleared the accumulated attempts before counting this one.
    expect(result.next.attempts).toBe(1);
  });
});
