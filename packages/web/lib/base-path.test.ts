import { describe, expect, it, vi } from "vitest";

describe("base path helpers", () => {
  it("prefixes app paths when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/reel");
    vi.resetModules();
    const { withBasePath, stripBasePath } = await import("./base-path");
    expect(withBasePath("/media/5/")).toBe("/reel/media/5/");
    expect(withBasePath("/")).toBe("/reel/");
    expect(stripBasePath("/reel/media/5/")).toBe("/media/5/");
    expect(stripBasePath("/reel")).toBe("/");
    vi.unstubAllEnvs();
  });

  it("does not double-prefix already-prefixed paths", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/reel");
    vi.resetModules();
    const { withBasePath } = await import("./base-path");
    expect(withBasePath("/reel/api/stream/1")).toBe("/reel/api/stream/1");
    expect(withBasePath("/reel/api/subtitles/12?offset=1.5")).toBe(
      "/reel/api/subtitles/12?offset=1.5",
    );
    expect(withBasePath("/reel")).toBe("/reel");
    expect(withBasePath("/reel/")).toBe("/reel/");
    vi.unstubAllEnvs();
  });

  it("leaves paths unchanged when no base path is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    vi.stubEnv("MEDIA_PUBLIC_PREFIX", "");
    vi.resetModules();
    const { withBasePath, stripBasePath } = await import("./base-path");
    expect(withBasePath("/media/5/")).toBe("/media/5/");
    expect(stripBasePath("/reel/media/5/")).toBe("/reel/media/5/");
    vi.unstubAllEnvs();
  });
});
