import { beforeEach, describe, expect, it } from "vitest";
import {
  cycleVideoDisplayMode,
  loadVideoDisplayMode,
  saveVideoDisplayMode,
  videoDisplayModeClass,
  videoDisplayModeHint,
  videoDisplayModeLabel,
  VIDEO_DISPLAY_MODE_ORDER,
} from "./video-display-mode.js";

describe("video display mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("cycles fit → fill → stretch → fit", () => {
    expect(cycleVideoDisplayMode("fit")).toBe("fill");
    expect(cycleVideoDisplayMode("fill")).toBe("stretch");
    expect(cycleVideoDisplayMode("stretch")).toBe("fit");
  });

  it("persists mode in localStorage", () => {
    saveVideoDisplayMode("fill");
    expect(loadVideoDisplayMode()).toBe("fill");
  });

  it("defaults to fit when storage is empty or invalid", () => {
    expect(loadVideoDisplayMode()).toBe("fit");
    window.localStorage.setItem("media-video-display-mode", "invalid");
    expect(loadVideoDisplayMode()).toBe("fit");
  });

  it("maps modes to CSS object-fit classes", () => {
    for (const mode of VIDEO_DISPLAY_MODE_ORDER) {
      expect(videoDisplayModeClass(mode)).toMatch(/^object-/);
    }
    expect(videoDisplayModeClass("fit")).toBe("object-contain");
    expect(videoDisplayModeClass("fill")).toBe("object-cover");
    expect(videoDisplayModeClass("stretch")).toBe("object-fill");
  });

  it("provides human-readable labels and hints", () => {
    expect(videoDisplayModeLabel("fit")).toBe("Fit");
    expect(videoDisplayModeHint("stretch")).toContain("Stretch");
  });
});
