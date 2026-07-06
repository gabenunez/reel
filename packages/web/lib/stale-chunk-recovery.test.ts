import { describe, expect, it } from "vitest";
import { isStaleChunkMessage } from "./stale-chunk-recovery";

describe("isStaleChunkMessage", () => {
  it("detects common stale chunk errors", () => {
    expect(isStaleChunkMessage("ChunkLoadError: Loading chunk 123 failed")).toBe(true);
    expect(isStaleChunkMessage("Failed to fetch dynamically imported module")).toBe(true);
    expect(isStaleChunkMessage("Importing a module script failed.")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isStaleChunkMessage("NetworkError when attempting to fetch resource.")).toBe(false);
    expect(isStaleChunkMessage("Could not load this video")).toBe(false);
  });
});
