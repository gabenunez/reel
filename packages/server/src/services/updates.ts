import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GITHUB_REPO, isNewerVersion, normalizeVersion } from "@reel/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_CACHE_MS = 15 * 60 * 1000;

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestReleaseName: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  updateSupported: boolean;
  updateInProgress: boolean;
  installDir: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

let cachedCheck: { at: number; status: UpdateStatus } | null = null;

function findInstallDirFrom(startDir: string): string | null {
  let dir = startDir;

  for (let i = 0; i < 8; i++) {
    const updateScript = path.join(dir, "scripts/update.sh");
    const pkgPath = path.join(dir, "package.json");

    if (fs.existsSync(updateScript)) {
      return dir;
    }

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "reel" && fs.existsSync(updateScript)) {
          return dir;
        }
      } catch {
        // keep walking
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export function detectInstallDir(): string {
  if (process.env.REEL_INSTALL_DIR?.trim()) {
    return process.env.REEL_INSTALL_DIR.trim();
  }

  const fromCwd = findInstallDirFrom(process.cwd());
  if (fromCwd) return fromCwd;

  const fromModule = findInstallDirFrom(__dirname);
  if (fromModule) return fromModule;

  if (fs.existsSync("/opt/reel/scripts/update.sh")) {
    return "/opt/reel";
  }

  return process.cwd();
}

export function getCurrentVersion(installDir = detectInstallDir()): string {
  try {
    const pkgPath = path.join(installDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    if (pkg.version?.trim()) {
      return normalizeVersion(pkg.version);
    }
  } catch {
    // fall through
  }

  return "0.0.0";
}

function getUpdateLockPath(): string {
  return path.join(os.homedir(), ".config/reel/updating.lock");
}

export function isUpdateInProgress(): boolean {
  return fs.existsSync(getUpdateLockPath());
}

function isUpdateSupported(installDir: string): boolean {
  const updateScript = path.join(installDir, "scripts/update.sh");
  return fs.existsSync(updateScript) && fs.existsSync(installDir);
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  const res = await fetch(GITHUB_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Reel/${getCurrentVersion()}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }

  const release = (await res.json()) as GitHubRelease;
  if (release.draft || release.prerelease) {
    return null;
  }

  return release;
}

export async function checkForUpdates(force = false): Promise<UpdateStatus> {
  const installDir = detectInstallDir();
  const currentVersion = getCurrentVersion(installDir);
  const updateSupported = isUpdateSupported(installDir);
  const updateInProgress = isUpdateInProgress();

  if (
    !force &&
    cachedCheck &&
    Date.now() - cachedCheck.at < CHECK_CACHE_MS &&
    cachedCheck.status.currentVersion === currentVersion
  ) {
    return {
      ...cachedCheck.status,
      updateInProgress,
      updateSupported,
    };
  }

  let latestVersion: string | null = null;
  let latestReleaseName: string | null = null;
  let releaseUrl: string | null = null;
  let releaseNotes: string | null = null;
  let publishedAt: string | null = null;
  let updateAvailable = false;

  try {
    const release = await fetchLatestRelease();
    if (release) {
      latestVersion = normalizeVersion(release.tag_name);
      latestReleaseName = release.name || release.tag_name;
      releaseUrl = release.html_url;
      releaseNotes = release.body?.trim() || null;
      publishedAt = release.published_at;
      updateAvailable = isNewerVersion(latestVersion, currentVersion);
    }
  } catch {
    // Leave defaults — still return current version info.
  }

  const status: UpdateStatus = {
    currentVersion,
    latestVersion,
    latestReleaseName,
    updateAvailable,
    releaseUrl,
    releaseNotes,
    publishedAt,
    updateSupported,
    updateInProgress,
    installDir,
  };

  cachedCheck = { at: Date.now(), status };
  return status;
}

export function triggerUpdate(releaseTag: string, installDir = detectInstallDir()): void {
  if (isUpdateInProgress()) {
    throw new Error("An update is already in progress");
  }

  const updateScript = path.join(installDir, "scripts/update.sh");
  if (!fs.existsSync(updateScript)) {
    throw new Error("Update script not found on this server");
  }

  const configDir = path.join(os.homedir(), ".config/reel");
  fs.mkdirSync(configDir, { recursive: true });
  const logPath = path.join(configDir, "update.log");
  fs.writeFileSync(getUpdateLockPath(), `${Date.now()}\n${releaseTag}\n`);
  fs.appendFileSync(logPath, `\n--- Update started ${new Date().toISOString()} (${releaseTag}) ---\n`);

  const logFd = fs.openSync(logPath, "a");

  const home = os.homedir();
  const nodeBin = path.join(home, "node", "bin");
  const pathEnv = fs.existsSync(nodeBin)
    ? `${nodeBin}:${process.env.PATH ?? ""}`
    : process.env.PATH;

  const child = spawn("bash", [updateScript], {
    cwd: installDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      REEL_NONINTERACTIVE: "1",
      REEL_RELEASE_TAG: releaseTag,
      REEL_INSTALL_DIR: installDir,
      REEL_REPO: `https://github.com/${GITHUB_REPO}.git`,
      GIT_TERMINAL_PROMPT: "0",
      HOME: home,
      PATH: pathEnv,
    },
  });

  child.unref();
  fs.closeSync(logFd);
}
