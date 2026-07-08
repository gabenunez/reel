// Runtime API port for /api rewrites — must NOT use the ephemeral prerender port (18197).
const runtimeApiPort = process.env.MEDIA_RUNTIME_API_PORT ?? "8097";

function buildImageRemotePatterns() {
  /** @type {import('next').NextConfig['images']['remotePatterns']} */
  const patterns = [
    {
      protocol: "https",
      hostname: "image.tmdb.org",
      pathname: "/**",
    },
  ];

  for (const value of [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.MEDIA_INTERNAL_API_URL,
  ]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      patterns.push({
        protocol: parsed.protocol.replace(":", ""),
        hostname: parsed.hostname,
        ...(parsed.port ? { port: parsed.port } : {}),
        pathname: "/api/images/**",
      });
    } catch {
      // ignore invalid env URLs
    }
  }

  return patterns;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://127.0.0.1:${runtimeApiPort}/api/:path*`,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86_400,
    remotePatterns: buildImageRemotePatterns(),
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
  },
  experimental: {
    optimizePackageImports: [
      "@radix-ui/react-dialog",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
    ],
  },
};

export default nextConfig;
