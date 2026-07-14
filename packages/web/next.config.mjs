// Runtime API port for /api rewrites — must NOT use the ephemeral prerender port (18197).
const runtimeApiPort =
  process.env.MEDIA_INTERNAL_API_PORT ??
  process.env.MEDIA_RUNTIME_API_PORT ??
  "8097";

function normalizePublicPrefix(value) {
  if (!value || value === "/") return "";
  const trimmed = String(value).replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const publicPrefix = normalizePublicPrefix(process.env.MEDIA_PUBLIC_PREFIX);
// Next may validate local sources before or after removing basePath.
const localImagePaths = [
  "/api/images/**",
  ...(publicPrefix ? [`${publicPrefix}/api/images/**`] : []),
];

function buildImageRemotePatterns() {
  /** @type {import('next').NextConfig['images']['remotePatterns']} */
  const patterns = [
    {
      protocol: "https",
      hostname: "image.tmdb.org",
      pathname: "/**",
    },
  ];

  for (const host of ["localhost", "127.0.0.1"]) {
    patterns.push({
      protocol: "http",
      hostname: host,
      pathname: "/api/images/**",
    });
  }

  for (const value of [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.MEDIA_INTERNAL_API_URL,
    process.env.MEDIA_WEB_INTERNAL_URL,
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
  ...(publicPrefix ? { basePath: publicPrefix } : {}),
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  async rewrites() {
    const apiDestination = `http://127.0.0.1:${runtimeApiPort}/api/:path*`;
    const rules = [
      {
        // Under basePath this matches /{prefix}/api/... (browser + TV WebView).
        source: "/api/:path*",
        destination: apiDestination,
      },
    ];
    if (publicPrefix) {
      // Android TV pairs against host:port without the public prefix; keep
      // unprefixed /api reachable on the public Next port.
      rules.push({
        source: "/api/:path*",
        destination: apiDestination,
        basePath: false,
      });
    }
    return rules;
  },
  async redirects() {
    if (!publicPrefix) return [];
    return [
      {
        // LAN/TV clients that open the origin root still land under basePath.
        source: "/",
        destination: `${publicPrefix}/`,
        basePath: false,
        permanent: false,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Next 16 defaults to [75]; preload URLs and any custom quality must be listed.
    qualities: [75, 80],
    minimumCacheTTL: 86_400,
    localPatterns: localImagePaths.map((pathname) => ({ pathname })),
    remotePatterns: buildImageRemotePatterns(),
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
    NEXT_PUBLIC_BASE_PATH: publicPrefix,
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
