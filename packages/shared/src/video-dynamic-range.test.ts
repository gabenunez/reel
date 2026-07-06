import { describe, expect, it } from "vitest";
import {
  buildTranscodeVideoFilter,
  formatDynamicRangeShort,
  formatDynamicRangeChromeSuffix,
  needsHdrToneMap,
  parseVideoDynamicRangeFromStream,
} from "./video-dynamic-range.js";

describe("parseVideoDynamicRangeFromStream", () => {
  it("detects Dolby Vision side data", () => {
    expect(
      parseVideoDynamicRangeFromStream({
        side_data_list: [
          {
            side_data_type: "DOVI configuration record",
            dv_profile: 7,
          },
        ],
      }),
    ).toEqual({
      dolbyVision: true,
      dolbyVisionProfile: 7,
      hdr10: false,
      hlg: false,
    });
  });

  it("detects HDR10 from color metadata", () => {
    expect(
      parseVideoDynamicRangeFromStream({
        color_primaries: "bt2020",
        color_transfer: "smpte2084",
        color_space: "bt2020nc",
      }),
    ).toEqual({
      dolbyVision: false,
      dolbyVisionProfile: null,
      hdr10: true,
      hlg: false,
    });
  });

  it("detects HLG", () => {
    expect(
      parseVideoDynamicRangeFromStream({
        color_transfer: "arib-std-b67",
      }),
    ).toMatchObject({ hlg: true });
  });
});

describe("formatDynamicRangeShort", () => {
  it("formats Dolby Vision profile", () => {
    expect(
      formatDynamicRangeShort({
        dolbyVision: true,
        dolbyVisionProfile: 5,
        hdr10: false,
        hlg: false,
      }),
    ).toBe("Dolby Vision P5");
  });

  it("returns null for SDR probes", () => {
    expect(
      formatDynamicRangeShort({
        dolbyVision: false,
        dolbyVisionProfile: null,
        hdr10: false,
        hlg: false,
      }),
    ).toBeNull();
  });
});

describe("formatDynamicRangeChromeSuffix", () => {
  it("returns empty string for SDR", () => {
    expect(
      formatDynamicRangeChromeSuffix({
        dolbyVision: false,
        dolbyVisionProfile: null,
        hdr10: false,
        hlg: false,
      }),
    ).toBe("");
  });

  it("prefixes HDR labels for watch chrome", () => {
    expect(
      formatDynamicRangeChromeSuffix({
        dolbyVision: false,
        dolbyVisionProfile: null,
        hdr10: true,
        hlg: false,
      }),
    ).toBe(" · HDR10");
  });
});

describe("buildTranscodeVideoFilter", () => {
  it("adds tonemap for HDR content", () => {
    expect(
      buildTranscodeVideoFilter(1080, {
        dolbyVision: true,
        dolbyVisionProfile: 7,
        hdr10: false,
        hlg: false,
      }),
    ).toContain("tonemap");
  });

  it("keeps SDR filter simple", () => {
    expect(buildTranscodeVideoFilter(720, null)).toBe("scale=-2:720");
    expect(needsHdrToneMap(null)).toBe(false);
  });
});
