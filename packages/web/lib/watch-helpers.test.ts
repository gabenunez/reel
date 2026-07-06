import { describe, expect, it } from "vitest";
import {
  nextFallbackQuality,
  resolveFallbackQuality,
} from "./watch-helpers.js";

describe("nextFallbackQuality", () => {
  it("steps down through the fallback order", () => {
    const available = ["original", "1080p", "720p", "480p"] as const;
    expect(nextFallbackQuality("original", [...available])).toBe("1080p");
    expect(nextFallbackQuality("1080p", [...available])).toBe("720p");
    expect(nextFallbackQuality("480p", [...available])).toBeNull();
  });

  it("skips tiers that are not available", () => {
    expect(
      nextFallbackQuality("original", ["original", "720p", "480p"]),
    ).toBe("720p");
  });
});

describe("resolveFallbackQuality", () => {
  const widescreen1080 = ["original", "480p", "720p", "1080p"] as const;

  it("steps from remux failure to source-matched transcode tier", () => {
    expect(
      resolveFallbackQuality(
        "original",
        [...widescreen1080],
        "remux",
        800,
        1920,
      ),
    ).toBe("1080p");
  });

  it("does not jump to 2160p after remux failure on 1080p sources", () => {
    const with4k = ["original", "480p", "720p", "1080p", "2160p"] as const;
    expect(
      resolveFallbackQuality(
        "original",
        [...with4k],
        "remux",
        800,
        1920,
      ),
    ).toBe("1080p");
  });

  it("skips duplicate 2160p when already transcoding at 2160p", () => {
    const with4k = ["original", "1080p", "720p", "480p", "2160p"] as const;
    expect(
      resolveFallbackQuality("original", [...with4k], "2160p", 2160, 3840),
    ).toBe("1080p");
  });
});
