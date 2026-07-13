import { describe, expect, it } from "vitest";
import { nextOptimizedImageUrl, snapNextImageWidth } from "./next-image-url";

describe("snapNextImageWidth", () => {
  it("maps common hero preload widths onto Next-allowed sizes", () => {
    expect(snapNextImageWidth(1280)).toBe(1200);
    expect(snapNextImageWidth(1200)).toBe(1200);
    expect(snapNextImageWidth(1920)).toBe(1920);
    expect(snapNextImageWidth(0)).toBe(1200);
  });
});

describe("nextOptimizedImageUrl", () => {
  it("never emits a disallowed w parameter", () => {
    expect(nextOptimizedImageUrl("/api/images/foo.jpg", 1280)).toContain("w=1200");
    expect(nextOptimizedImageUrl("/api/images/foo.jpg", 1280)).not.toContain("w=1280");
  });
});
