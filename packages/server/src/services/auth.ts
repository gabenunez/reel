import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import type { ConfigManager } from "../config.js";

export const SESSION_COOKIE = "reel_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CAST_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

export interface CastTokenGrant {
  fileId: number;
  mediaType: "movie" | "episode";
  subtitleId?: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, salt, hash] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(derived, "hex"),
    );
  } catch {
    return false;
  }
}

export class AuthService {
  private sessionSecret: string;

  constructor(private configManager: ConfigManager) {
    this.sessionSecret = this.loadSessionSecret();
  }

  private loadSessionSecret(): string {
    const secretPath = path.join(
      this.configManager.get().data_dir,
      "auth_secret",
    );
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, "utf-8").trim();
    }

    const secret = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  }

  isPasswordRequired(): boolean {
    const hash = this.configManager.get().auth?.password_hash?.trim();
    return Boolean(hash);
  }

  verifyPassword(password: string): boolean {
    const hash = this.configManager.get().auth?.password_hash;
    if (!hash) return false;
    return verifyPassword(password, hash);
  }

  setPassword(password: string): void {
    this.configManager.setPasswordHash(hashPassword(password));
  }

  clearPassword(): void {
    this.configManager.clearPasswordHash();
  }

  createSessionToken(): string {
    const payload = {
      exp: Date.now() + SESSION_TTL_MS,
      nonce: crypto.randomBytes(16).toString("hex"),
    };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto
      .createHmac("sha256", this.sessionSecret)
      .update(data)
      .digest("base64url");
    return `${data}.${sig}`;
  }

  verifySessionToken(token: string): boolean {
    const [data, sig] = token.split(".");
    if (!data || !sig) return false;

    const expected = crypto
      .createHmac("sha256", this.sessionSecret)
      .update(data)
      .digest("base64url");

    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return false;
      }
    } catch {
      return false;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(data, "base64url").toString("utf-8"),
      ) as { exp?: number };
      return typeof payload.exp === "number" && payload.exp > Date.now();
    } catch {
      return false;
    }
  }

  getSessionToken(request: FastifyRequest): string | null {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;

    for (const part of cookieHeader.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE) {
        return decodeURIComponent(rest.join("="));
      }
    }

    return null;
  }

  isAuthenticated(request: FastifyRequest): boolean {
    if (!this.isPasswordRequired()) return true;
    const token = this.getSessionToken(request);
    return token ? this.verifySessionToken(token) : false;
  }

  sessionCookie(token: string): string {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  }

  clearSessionCookie(): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  createCastToken(grant: CastTokenGrant): string {
    const payload = {
      exp: Date.now() + CAST_TOKEN_TTL_MS,
      fid: grant.fileId,
      mt: grant.mediaType,
      sid: grant.subtitleId ?? null,
    };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto
      .createHmac("sha256", this.sessionSecret)
      .update(data)
      .digest("base64url");
    return `${data}.${sig}`;
  }

  verifyCastToken(token: string, pathname: string): boolean {
    const [data, sig] = token.split(".");
    if (!data || !sig) return false;

    const expected = crypto
      .createHmac("sha256", this.sessionSecret)
      .update(data)
      .digest("base64url");

    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return false;
      }
    } catch {
      return false;
    }

    let payload: {
      exp?: number;
      fid?: number;
      mt?: string;
      sid?: number | null;
    };
    try {
      payload = JSON.parse(
        Buffer.from(data, "base64url").toString("utf-8"),
      ) as typeof payload;
    } catch {
      return false;
    }

    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) {
      return false;
    }
    if (typeof payload.fid !== "number") return false;

    const streamMatch = pathname.match(/^\/api\/stream\/(\d+)(?:\/|$)/);
    if (streamMatch) {
      return parseInt(streamMatch[1], 10) === payload.fid;
    }

    const subtitleMatch = pathname.match(/^\/api\/subtitles\/(\d+)$/);
    if (subtitleMatch) {
      const subtitleId = parseInt(subtitleMatch[1], 10);
      return payload.sid === subtitleId;
    }

    return false;
  }
}

export function isPublicPath(pathname: string, passwordRequired: boolean): boolean {
  if (
    pathname === "/api/auth/status" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/status"
  ) {
    return true;
  }

  if (!passwordRequired && pathname === "/api/settings/password") {
    return true;
  }

  if (
    !passwordRequired &&
    (pathname === "/api/settings" ||
      pathname.startsWith("/api/browse"))
  ) {
    return true;
  }

  return false;
}

export function isCastMediaPath(pathname: string): boolean {
  return (
    /^\/api\/stream\/\d+(\/|$)/.test(pathname) ||
    /^\/api\/subtitles\/\d+$/.test(pathname)
  );
}
