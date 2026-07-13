import { describe, expect, it } from "vitest";
import type { AppConfig } from "@media-app/shared";
import type { FastifyRequest } from "fastify";
import { getCastBaseUrl, toAbsoluteUrl, withPublicPrefix } from "./network.js";

function configWithPrefix(prefix?: string): AppConfig {
  return {
    server: {
      port: 8096,
      host: "0.0.0.0",
      ...(prefix ? { public_prefix: prefix } : {}),
    },
    data_dir: "/tmp",
    transcoding: {
      enabled: true,
      cache_dir: "/tmp",
      hls_segment_duration: 6,
    },
    metadata: {},
  } as AppConfig;
}

describe("withPublicPrefix", () => {
  it("leaves values unchanged when no public_prefix is configured", () => {
    const config = configWithPrefix();
    expect(withPublicPrefix(config, "/api/stream/1/hls/segment_001.ts")).toBe(
      "/api/stream/1/hls/segment_001.ts",
    );
    expect(withPublicPrefix(config, "https://example.com")).toBe(
      "https://example.com",
    );
  });

  it("prefixes API paths and origins for reverse-proxy installs", () => {
    const config = configWithPrefix("/reel");
    expect(withPublicPrefix(config, "/api/stream/1/hls/segment_001.ts")).toBe(
      "/reel/api/stream/1/hls/segment_001.ts",
    );
    expect(withPublicPrefix(config, "https://example.com")).toBe(
      "https://example.com/reel",
    );
    expect(withPublicPrefix(config, "https://example.com/reel")).toBe(
      "https://example.com/reel",
    );
    expect(withPublicPrefix(config, "/reel/api/stream/1")).toBe(
      "/reel/api/stream/1",
    );
  });
});

describe("toAbsoluteUrl", () => {
  it("joins cast base (with public_prefix) and API paths", () => {
    expect(
      toAbsoluteUrl(
        "https://example.com/reel",
        "/api/stream/1/hls/segment_001.ts?type=movie",
      ),
    ).toBe("https://example.com/reel/api/stream/1/hls/segment_001.ts?type=movie");
  });
});

describe("getCastBaseUrl", () => {
  it("preserves the public reverse-proxy host for Chromecast URLs", () => {
    const request = {
      headers: {
        host: "127.0.0.1:8097",
        "x-forwarded-host": "dotpeenge.crios.bysh.me",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
    } as unknown as FastifyRequest;

    expect(getCastBaseUrl(request, configWithPrefix("/reel"))).toBe(
      "https://dotpeenge.crios.bysh.me/reel",
    );
  });
});
