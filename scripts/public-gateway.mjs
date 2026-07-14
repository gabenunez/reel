#!/usr/bin/env node
/**
 * Public front door when MEDIA_PUBLIC_PREFIX is set.
 * - Redirects / → {prefix}/ (preserves query string)
 * - Proxies everything else to the Next standalone server on 127.0.0.1
 *
 * Must not impose request timeouts: stream/HLS traffic also flows through here.
 */
import http from "node:http";

const publicPort = Number(process.env.MEDIA_GATEWAY_PORT || process.env.PORT || "8096");
const upstreamPort = Number(process.env.MEDIA_WEB_UPSTREAM_PORT || "8098");
const host = process.env.MEDIA_HOST || "0.0.0.0";
const rawPrefix = (process.env.MEDIA_PUBLIC_PREFIX || "").trim().replace(/\/+$/, "");
const publicPrefix =
  !rawPrefix || rawPrefix === "/"
    ? ""
    : rawPrefix.startsWith("/")
      ? rawPrefix
      : `/${rawPrefix}`;

const DROP_REQUEST_HEADERS = new Set(["connection", "keep-alive", "proxy-connection"]);
const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  // Node will set these appropriately when piping the upstream body.
  "transfer-encoding",
]);

function filterHeaders(source, drop) {
  /** @type {Record<string, string | string[] | undefined>} */
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (drop.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function proxy(req, res) {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      path: req.url,
      method: req.method,
      // Keep transfer-encoding / content-length so chunked POST bodies stay valid.
      headers: filterHeaders(req.headers, DROP_REQUEST_HEADERS),
      timeout: 0,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, filterHeaders(upRes.headers, DROP_RESPONSE_HEADERS));
      upRes.pipe(res);
    },
  );

  upstream.on("timeout", () => {
    upstream.destroy(new Error("upstream timeout"));
  });

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end(`Bad gateway: ${err.message}`);
  });

  req.on("aborted", () => {
    upstream.destroy();
  });
  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  let pathname = "/";
  let search = "";
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = url.pathname;
    search = url.search;
  } catch {
    // Malformed URL — fall through to upstream / 400 path via proxy.
  }

  if (publicPrefix && (pathname === "/" || pathname === "")) {
    res.writeHead(302, {
      Location: `${publicPrefix}/${search}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  proxy(req, res);
});

// Node 18+ defaults requestTimeout to 5 minutes — that would kill movie streams.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 65_000;

server.listen(publicPort, host, () => {
  console.log(
    `MEDIA! gateway on http://${host}:${publicPort} → 127.0.0.1:${upstreamPort}` +
      (publicPrefix ? ` (root → ${publicPrefix}/)` : ""),
  );
});
