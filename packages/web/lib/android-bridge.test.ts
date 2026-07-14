import { afterEach, describe, expect, it, vi } from "vitest";

describe("toAbsoluteMediaUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    // @ts-expect-error happy-dom window cleanup
    delete globalThis.window;
  });

  it("absolutizes already-prefixed api paths without doubling the base path", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/reel");
    vi.resetModules();

    globalThis.window = {
      location: { origin: "https://media.example" },
    } as Window & typeof globalThis;

    const { toAbsoluteMediaUrl } = await import("./android-bridge");
    expect(toAbsoluteMediaUrl("/reel/api/stream/42?type=movie")).toBe(
      "https://media.example/reel/api/stream/42?type=movie",
    );
    expect(toAbsoluteMediaUrl("/api/stream/42?type=movie")).toBe(
      "https://media.example/reel/api/stream/42?type=movie",
    );
  });
});
