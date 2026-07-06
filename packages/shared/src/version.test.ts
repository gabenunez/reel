import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewerVersion,
  normalizeVersion,
} from "./version.js";

describe("normalizeVersion", () => {
  it("strips leading v prefix", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
  });
});

describe("compareVersions", () => {
  it("orders semantic versions", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("isNewerVersion", () => {
  it("detects newer releases", () => {
    expect(isNewerVersion("1.3.0", "1.2.9")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
  });
});
