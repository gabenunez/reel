import { describe, expect, it, vi } from "vitest";

describe("gateway", () => {
  it("maps internal paths through the public entry URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_GATEWAY_PREFIX", "/reel");
    const { toGatewayUrl, pathnameFromGatewayUrl, parseGatewayLocation, resolveGatewayRewritePath } =
      await import("./gateway");

    expect(toGatewayUrl("/")).toBe("/reel");
    expect(toGatewayUrl("/media/5/")).toBe("/reel?__p=%2Fmedia%2F5%2F");
    expect(toGatewayUrl("/watch/movie/30/?media=30")).toBe(
      "/reel?__p=%2Fwatch%2Fmovie%2F30%2F%3Fmedia%3D30",
    );

    expect(pathnameFromGatewayUrl("/reel", "")).toBe("/");
    expect(pathnameFromGatewayUrl("/reel", "?__p=%2Fmedia%2F5%2F")).toBe("/media/5/");

    const location = parseGatewayLocation(
      "/reel",
      "?__p=%2Fwatch%2Fmovie%2F30%2F%3Fmedia%3D30",
    );
    expect(location.pathname).toBe("/watch/movie/30/");
    expect(location.searchParams.get("media")).toBe("30");

    expect(resolveGatewayRewritePath("/", "?__p=%2Fapi%2Fstatus")).toEqual({
      pathname: "/api/status",
      search: "",
    });

    vi.stubEnv("MEDIA_GATEWAY_PREFIX", "/reel");
    const runtime = await import("./gateway");
    expect(runtime.resolveGatewayRewritePath("/", "?__p=%2Fapi%2Fstatus")).toEqual({
      pathname: "/api/status",
      search: "",
    });

    vi.unstubAllEnvs();
  });
});
