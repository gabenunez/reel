import { describe, expect, it } from "vitest";
import { normalizeReleaseTag, prepareUpdateApply } from "./updates.js";

describe("normalizeReleaseTag", () => {
  it("accepts tags with or without a v prefix", () => {
    expect(normalizeReleaseTag("v0.1.70")).toBe("v0.1.70");
    expect(normalizeReleaseTag("0.1.70")).toBe("v0.1.70");
  });

  it("rejects invalid tags", () => {
    expect(() => normalizeReleaseTag("latest")).toThrow("Invalid release tag");
  });
});

describe("prepareUpdateApply", () => {
  it("rejects when already on the requested release", () => {
    expect(() => prepareUpdateApply("v0.1.70")).toThrow(
      "You are already on the latest release",
    );
  });
});
