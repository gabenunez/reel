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
  updateProgress: UpdateProgress | null;
}

export type UpdatePhase =
  | "preparing"
  | "downloading"
  | "building"
  | "restarting"
  | "complete"
  | "failed"
  | "unknown";

export type UpdateStepStatus = "pending" | "active" | "complete" | "failed";

export interface UpdateStep {
  id: UpdatePhase;
  label: string;
  status: UpdateStepStatus;
}

export interface UpdateProgress {
  phase: UpdatePhase;
  message: string;
  releaseTag: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  elapsedMs: number;
  steps: UpdateStep[];
  logTail: string[];
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

function getConfigDir(): string {
  return path.join(os.homedir(), ".config/reel");
}

function getUpdateLogPath(): string {
  return path.join(getConfigDir(), "update.log");
}

function getUpdateProgressPath(): string {
  return path.join(getConfigDir(), "update-progress.json");
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

const UPDATE_STEP_ORDER: UpdatePhase[] = [
  "preparing",
  "downloading",
  "building",
  "restarting",
];

const UPDATE_STEP_LABELS: Record<UpdatePhase, string> = {
  preparing: "Prepare update",
  downloading: "Download release",
  building: "Build application",
  restarting: "Restart server",
  complete: "Complete",
  failed: "Failed",
  unknown: "Working",
};

function buildUpdateSteps(phase: UpdatePhase): UpdateStep[] {
  if (phase === "complete") {
    return UPDATE_STEP_ORDER.map((id) => ({
      id,
      label: UPDATE_STEP_LABELS[id],
      status: "complete" as const,
    }));
  }

  if (phase === "failed") {
    const activeIndex = UPDATE_STEP_ORDER.length - 1;
    return UPDATE_STEP_ORDER.map((id, index) => ({
      id,
      label: UPDATE_STEP_LABELS[id],
      status:
        index < activeIndex
          ? ("complete" as const)
          : index === activeIndex
            ? ("failed" as const)
            : ("pending" as const),
    }));
  }

  const activeIndex = Math.max(0, UPDATE_STEP_ORDER.indexOf(phase));

  return UPDATE_STEP_ORDER.map((id, index) => ({
    id,
    label: UPDATE_STEP_LABELS[id],
    status:
      index < activeIndex
        ? ("complete" as const)
        : index === activeIndex
          ? ("active" as const)
          : ("pending" as const),
  }));
}

function inferPhaseFromLog(lines: string[]): UpdatePhase {
  const text = lines.join("\n");
  if (/Update complete|Update finished|upgraded to/i.test(text)) return "complete";
  if (/Restarting via|Restarting reel service|Restarting Reel process/i.test(text)) {
    return "restarting";
  }
  if (/\[3\] Building|Installing dependencies and building|Tasks:\s+\d+ successful/i.test(text)) {
    return "building";
  }
  if (/\[2\] Downloading|Checking out release|Pulling latest|Synced release/i.test(text)) {
    return "downloading";
  }
  if (/\[1\] Checking install|Preparing update/i.test(text)) return "preparing";
  if (/Update failed|✗|failed/i.test(text)) return "failed";
  return "unknown";
}

function readLogTail(maxLines = 12): string[] {
  const logPath = getUpdateLogPath();
  if (!fs.existsSync(logPath)) return [];

  try {
    const raw = fs.readFileSync(logPath, "utf8");
    return raw
      .split("\n")
      .map((line) => stripAnsi(line).trim())
      .filter(Boolean)
      .filter(
        (line) =>
          !line.startsWith("--- Update started") &&
          !/^━+$/.test(line) &&
          line !== "Reel — Update" &&
          line !== "Pull latest, rebuild, and restart",
      )
      .slice(-maxLines);
  } catch {
    return [];
  }
}

function readLockMeta(): { startedAt: string | null; releaseTag: string | null } {
  const lockPath = getUpdateLockPath();
  if (!fs.existsSync(lockPath)) {
    return { startedAt: null, releaseTag: null };
  }

  try {
    const [startedMs, releaseTag] = fs.readFileSync(lockPath, "utf8").trim().split("\n");
    const startedAt = startedMs && /^\d+$/.test(startedMs)
      ? new Date(Number(startedMs)).toISOString()
      : null;
    return { startedAt, releaseTag: releaseTag?.trim() || null };
  } catch {
    return { startedAt: null, releaseTag: null };
  }
}

function writeUpdateProgress(
  phase: UpdatePhase,
  message: string,
  releaseTag: string | null,
): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    getUpdateProgressPath(),
    JSON.stringify({
      phase,
      message,
      releaseTag,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function getUpdateProgress(): UpdateProgress | null {
  if (!isUpdateInProgress()) {
    return null;
  }

  const logTail = readLogTail();
  const { startedAt, releaseTag: lockTag } = readLockMeta();
  const startedMs = startedAt ? Date.parse(startedAt) : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedMs);

  let phase: UpdatePhase = "unknown";
  let message = "Update in progress...";
  let releaseTag = lockTag;
  let updatedAt: string | null = null;

  const progressPath = getUpdateProgressPath();
  if (fs.existsSync(progressPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(progressPath, "utf8")) as {
        phase?: UpdatePhase;
        message?: string;
        releaseTag?: string | null;
        updatedAt?: string;
      };
      if (parsed.phase) phase = parsed.phase;
      if (parsed.message) message = parsed.message;
      if (parsed.releaseTag) releaseTag = parsed.releaseTag;
      if (parsed.updatedAt) updatedAt = parsed.updatedAt;
    } catch {
      // fall through to log inference
    }
  }

  if (phase === "unknown") {
    phase = inferPhaseFromLog(logTail);
  }

  if (message === "Update in progress...") {
    message = UPDATE_STEP_LABELS[phase] ?? message;
  }

  return {
    phase,
    message,
    releaseTag,
    startedAt,
    updatedAt,
    elapsedMs,
    steps: buildUpdateSteps(phase),
    logTail,
  };
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

  const finalize = (
    partial: Omit<UpdateStatus, "updateProgress">,
  ): UpdateStatus => ({
    ...partial,
    updateProgress: partial.updateInProgress ? getUpdateProgress() : null,
  });

  if (
    !force &&
    cachedCheck &&
    Date.now() - cachedCheck.at < CHECK_CACHE_MS &&
    cachedCheck.status.currentVersion === currentVersion
  ) {
    return finalize({
      ...cachedCheck.status,
      updateInProgress,
      updateSupported,
    });
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

  const status = finalize({
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
  });

  cachedCheck = { at: Date.now(), status: { ...status, updateProgress: null } };
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
  writeUpdateProgress("preparing", "Starting update...", releaseTag);

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
