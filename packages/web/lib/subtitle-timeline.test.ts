import { describe, expect, it } from "vitest";
import {
  resolveHlsSubtitleTimelineOffset,
  resolveWebSubtitlePlaybackSeconds,
} from "./subtitle-timeline";

describe("resolveHlsSubtitleTimelineOffset", () => {
  it("prefers a pending stream restart position", () => {
    expect(
      resolveHlsSubtitleTimelineOffset({
        streamStartSeconds: 7200,
        hlsStartOffsetLive: 3600,
        hlsStartOffset: 3600,
        initialResumeSeconds: 1800,
      }),
    ).toBe(7200);
  });

  it("uses the live HLS offset ref during playback", () => {
    expect(
      resolveHlsSubtitleTimelineOffset({
        streamStartSeconds: null,
        hlsStartOffsetLive: 3723.5,
        hlsStartOffset: 0,
        initialResumeSeconds: 1800,
        playbackActive: true,
      }),
    ).toBe(3723.5);
  });

  it("uses state offset when the live ref has not updated yet", () => {
    expect(
      resolveHlsSubtitleTimelineOffset({
        streamStartSeconds: null,
        hlsStartOffsetLive: 0,
        hlsStartOffset: 3600,
        initialResumeSeconds: 1800,
      }),
    ).toBe(3600);
  });

  it("falls back to resume point only before playback starts", () => {
    expect(
      resolveHlsSubtitleTimelineOffset({
        streamStartSeconds: null,
        hlsStartOffsetLive: 0,
        hlsStartOffset: 0,
        initialResumeSeconds: 3723.5,
        playbackActive: false,
      }),
    ).toBe(3723.5);
  });

  it("does not reuse saved resume after playback has started", () => {
    expect(
      resolveHlsSubtitleTimelineOffset({
        streamStartSeconds: null,
        hlsStartOffsetLive: 0,
        hlsStartOffset: 0,
        initialResumeSeconds: 3723.5,
        playbackActive: true,
      }),
    ).toBe(0);
  });

  it("returns zero for playback from the start", () => {
    expect(
      resolveHlsSubtitleTimelineOffset({
        streamStartSeconds: null,
        hlsStartOffsetLive: 0,
        hlsStartOffset: 0,
        initialResumeSeconds: 0,
      }),
    ).toBe(0);
  });
});

describe("resolveWebSubtitlePlaybackSeconds", () => {
  it("uses absolute video time for direct play", () => {
    expect(
      resolveWebSubtitlePlaybackSeconds({
        usingHlsPlayback: false,
        videoCurrentTime: 125.5,
        streamStartSeconds: null,
        hlsStartOffsetLive: 3600,
        hlsStartOffset: 3600,
        initialResumeSeconds: 3600,
      }),
    ).toBe(125.5);
  });

  it("adds the HLS offset to relative video time", () => {
    expect(
      resolveWebSubtitlePlaybackSeconds({
        usingHlsPlayback: true,
        videoCurrentTime: 42,
        streamStartSeconds: null,
        hlsStartOffsetLive: 3600,
        hlsStartOffset: 3600,
        initialResumeSeconds: 3600,
        playbackActive: true,
      }),
    ).toBe(3642);
  });
});
