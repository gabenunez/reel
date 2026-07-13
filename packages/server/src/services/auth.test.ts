import { describe, expect, it } from "vitest";
import { isPublicPath } from "./auth.js";

describe("public authentication paths", () => {
  it("does not expose server status when a password is configured", () => {
    expect(isPublicPath("/api/status", true)).toBe(false);
    expect(isPublicPath("/api/auth/status", true)).toBe(true);
    expect(isPublicPath("/api/auth/login", true)).toBe(true);
  });
});
