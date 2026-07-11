import os from "node:os";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "@media-app/shared";

function isPrivateIpv4(address: string): boolean {
  return (
    address.startsWith("192.168.") ||
    address.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function isVirtualInterface(name: string): boolean {
  return /^(lo|utun|bridge|awdl|llw|gif|stf|vmnet|vboxnet|docker|br-|tun|tap)/i.test(
    name,
  );
}

export function getLanBaseUrl(port: number): string {
  const interfaces = os.networkInterfaces();
  const candidates: Array<{ name: string; address: string }> = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (isVirtualInterface(name)) continue;
    for (const iface of entries ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }

  const preferred =
    candidates.find(({ name, address }) => name === "en0" && isPrivateIpv4(address)) ??
    candidates.find(({ name, address }) => /^en\d+$/i.test(name) && isPrivateIpv4(address)) ??
    candidates.find(({ address }) => isPrivateIpv4(address)) ??
    candidates.find(({ name }) => /^(en|eth|wlan|wifi)/i.test(name)) ??
    candidates[0];

  const address = preferred?.address ?? "127.0.0.1";
  return `http://${address}:${port}`;
}

export function getCastBaseUrl(
  request: FastifyRequest,
  config: AppConfig,
): string {
  const host = request.headers.host ?? "";
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol =
    (typeof forwardedProto === "string" ? forwardedProto : request.protocol) ??
    "http";

  if (host && !host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
    return `${protocol}://${host}`;
  }

  return getLanBaseUrl(config.server.port);
}

export function toAbsoluteUrl(baseUrl: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function appendQueryParam(
  url: string,
  key: string,
  value: string,
): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}
