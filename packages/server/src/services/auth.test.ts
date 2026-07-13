import { describe, expect, it } from "vitest";
import { isInternalMediaApiRequest, isPublicPath } from "./auth.js";

describe("public authentication paths", () => {
  it("keeps health and artwork public but protects detailed status when a password is configured", () => {
    expect(isPublicPath("/api/health", true)).toBe(true);
    expect(isPublicPath("/api/images/w500_abc.jpg", true)).toBe(true);
    expect(isPublicPath("/api/status", true)).toBe(false);
    expect(isPublicPath("/api/auth/status", true)).toBe(true);
    expect(isPublicPath("/api/auth/login", true)).toBe(true);
  });
});

describe("internal Next.js API requests", () => {
  it("allows SSR/ISR media fetches only with the internal token header", () => {
    expect(
      isInternalMediaApiRequest("/api/media/265", {
        "x-media-internal": "next-isr",
      }),
    ).toBe(true);
    expect(
      isInternalMediaApiRequest("/api/media/265", {
        "x-media-internal": "wrong",
      }),
    ).toBe(false);
    expect(isInternalMediaApiRequest("/api/media/265", {})).toBe(false);
    expect(
      isInternalMediaApiRequest("/api/status", {
        "x-media-internal": "next-isr",
      }),
    ).toBe(false);
  });
});
