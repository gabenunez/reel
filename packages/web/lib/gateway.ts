/** Query key used when routing through a single public entry path (e.g. /reel?__p=/media/5/). */
export const GATEWAY_QUERY_KEY = "__p";

function normalizeGatewayPrefix(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Runtime gateway prefix — prefer MEDIA_GATEWAY_PREFIX over build-inlined NEXT_PUBLIC_*. */
export function getGatewayPrefix(): string {
  return normalizeGatewayPrefix(
    process.env.MEDIA_GATEWAY_PREFIX ?? process.env.NEXT_PUBLIC_GATEWAY_PREFIX,
  );
}

/** @deprecated Use getGatewayPrefix() — kept for tests and gradual migration. */
export const GATEWAY_PREFIX = getGatewayPrefix();

export function gatewayEnabled(): boolean {
  return getGatewayPrefix().length > 0;
}

function normalizeAppPath(path: string): string {
  if (!path || path === "/") return "/";
  const withLeading = path.startsWith("/") ? path : `/${path}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function hasGatewayTarget(search: string): boolean {
  const outer = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const target = outer.get(GATEWAY_QUERY_KEY);
  return Boolean(target?.startsWith("/"));
}

function isGatewayEntryPath(pathname: string): boolean {
  const entry = getGatewayPrefix();
  return pathname === entry || pathname === `${entry}/` || (pathname === "/" && entry.length > 0);
}

/**
 * Map an internal app path to the URL the browser should request.
 * Home is the bare entry path; everything else uses ?__p=.
 */
export function toGatewayUrl(path: string): string {
  const entry = getGatewayPrefix();
  if (!entry) return path;

  if (!path || path === "/") return entry;

  const absolute = path.startsWith("http://") || path.startsWith("https://");
  if (absolute) {
    try {
      const url = new URL(path);
      return `${url.origin}${toGatewayUrl(`${url.pathname}${url.search}`)}`;
    } catch {
      return path;
    }
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  const params = new URLSearchParams();
  params.set(GATEWAY_QUERY_KEY, normalized);
  return `${entry}?${params.toString()}`;
}

/** Resolve the in-app pathname from a browser URL when gateway mode is active. */
export function pathnameFromGatewayUrl(pathname: string, search: string): string | null {
  if (!gatewayEnabled()) return null;
  if (!isGatewayEntryPath(pathname)) return null;
  if (pathname === "/" && !hasGatewayTarget(search)) return null;

  const outer = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const target = outer.get(GATEWAY_QUERY_KEY);
  if (!target) return "/";
  if (!target.startsWith("/")) return "/";

  const inner = new URL(target, "http://gateway.local");
  return normalizeAppPath(inner.pathname);
}

/** Split a browser URL into in-app pathname + merged query params (gateway-aware). */
export function parseGatewayLocation(
  pathname: string,
  search: string,
): { pathname: string; searchParams: URLSearchParams } {
  const gatewayPath = pathnameFromGatewayUrl(pathname, search);
  if (gatewayPath === null) {
    return {
      pathname,
      searchParams: new URLSearchParams(search.startsWith("?") ? search.slice(1) : search),
    };
  }

  const outer = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const target = outer.get(GATEWAY_QUERY_KEY);
  outer.delete(GATEWAY_QUERY_KEY);

  const merged = new URLSearchParams();
  if (target?.startsWith("/")) {
    const inner = new URL(target, "http://gateway.local");
    inner.searchParams.forEach((value, key) => merged.set(key, value));
  }
  outer.forEach((value, key) => merged.set(key, value));

  return { pathname: gatewayPath, searchParams: merged };
}

/** Build a NextResponse rewrite target from ?__p=… when gateway mode is enabled. */
export function resolveGatewayRewritePath(
  pathname: string,
  search: string,
): { pathname: string; search: string } | null {
  if (!gatewayEnabled()) return null;
  if (!isGatewayEntryPath(pathname)) return null;
  if (pathname === "/" && !hasGatewayTarget(search)) return null;

  const outer = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const target = outer.get(GATEWAY_QUERY_KEY);
  if (!target?.startsWith("/")) return null;

  const inner = new URL(target, "http://gateway.local");
  return {
    pathname: inner.pathname,
    search: inner.search,
  };
}

/** Prefix for fetch/stream URLs — explicit API URL wins, else gateway-wrap internal paths. */
export function publicUrl(path: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (apiBase) return `${apiBase.replace(/\/$/, "")}${path}`;
  return toGatewayUrl(path);
}

export function gatewayAssetBootstrapScript(): string {
  const entry = getGatewayPrefix();
  if (!entry) return "";
  return `(function(){try{var e=${JSON.stringify(entry)};function r(n){var a=n.tagName==="LINK"?"href":"src",v=n.getAttribute(a);if(!v||v.indexOf("/_next/")!==0)return;n.setAttribute(a,e+"?__p="+encodeURIComponent(v))}function s(root){root.querySelectorAll('link[href^="/_next/"],script[src^="/_next/"]').forEach(r)}s(document.documentElement);new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType!==1)return;if(n.matches&&n.matches('link[href^="/_next/"],script[src^="/_next/"]'))r(n);if(n.querySelectorAll)s(n)})})}).observe(document.documentElement,{childList:true,subtree:true})}catch(x){}})();`;
}
