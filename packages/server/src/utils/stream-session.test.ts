import { describe, expect, it } from "vitest";
import {
  createStreamFilePrefix,
  createStreamSessionId,
  createStreamSessionPrefix,
} from "./stream-session.js";

describe("createStreamSessionId", () => {
  it("builds a stable session id from type, file, quality, and start", () => {
    expect(createStreamSessionId("movie", 42, "1080p", 90.7)).toBe(
      "movie-42-1080p-90",
    );
    expect(createStreamSessionId("episode", 7, "remux")).toBe("episode-7-remux-0");
  });

  it("clamps negative start times to zero", () => {
    expect(createStreamSessionId("movie", 1, "720p", -5)).toBe("movie-1-720p-0");
  });
});

describe("createStreamSessionPrefix", () => {
  it("ends with a trailing dash for prefix matching", () => {
    expect(createStreamSessionPrefix("movie", 42, "1080p")).toBe(
      "movie-42-1080p-",
    );
  });
});

describe("createStreamFilePrefix", () => {
  it("identifies all qualities for a file", () => {
    expect(createStreamFilePrefix("episode", 12)).toBe("episode-12-");
  });
});
