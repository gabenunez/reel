import { describe, expect, it } from "vitest";
import {
  formatVttTimestamp,
  parseVttTimestamp,
  shiftVttByOffset,
} from "./vtt-timing.js";

describe("vtt-timing", () => {
  it("parses and formats short timestamps", () => {
    expect(parseVttTimestamp("01:23.456")).toBeCloseTo(83.456, 3);
    expect(formatVttTimestamp(83.456)).toBe("1:23.456");
  });

  it("parses and formats hour timestamps", () => {
    expect(parseVttTimestamp("1:02:03.500")).toBeCloseTo(3723.5, 3);
    expect(formatVttTimestamp(3723.5)).toBe("1:02:03.500");
  });

  it("shifts cues to align with an HLS resume offset", () => {
    const source = `WEBVTT

1
00:10:00.000 --> 00:10:02.000
Hello

2
00:10:05.000 --> 00:10:07.000
World`;

    const shifted = shiftVttByOffset(source, 600);
    expect(shifted).toContain("0:00.000 --> 0:02.000");
    expect(shifted).toContain("0:05.000 --> 0:07.000");
    expect(shifted).not.toContain("00:10:00.000");
  });

  it("drops cues that end before the offset", () => {
    const source = `WEBVTT

1
00:05:00.000 --> 00:05:02.000
Too early

2
00:10:00.000 --> 00:10:02.000
On time`;

    const shifted = shiftVttByOffset(source, 600);
    expect(shifted).not.toContain("Too early");
    expect(shifted).toContain("On time");
  });
});
