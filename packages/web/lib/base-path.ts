function normalizePublicPrefix(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Public URL prefix when served behind a reverse proxy (e.g. /reel). */
export function getPublicPrefix(): string {
  return normalizePublicPrefix(
    process.env.MEDIA_PUBLIC_PREFIX ?? process.env.NEXT_PUBLIC_BASE_PATH,
  );
}

/**
 * Prefix a path with the public base path when configured.
 * Idempotent: paths that already include the prefix are returned unchanged.
 */
export function withBasePath(path: string): string {
  const base = getPublicPrefix();
  if (!base) return path;

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === base || normalized.startsWith(`${base}/`)) {
    return normalized;
  }
  if (normalized === "/") return `${base}/`;
  return `${base}${normalized}`;
}

export function stripBasePath(pathname: string): string {
  const base = getPublicPrefix();
  if (!base) return pathname;
  if (pathname === base) return "/";
  if (pathname.startsWith(`${base}/`)) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}
