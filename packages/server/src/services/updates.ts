import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GITHUB_REPO, compareVersions, isNewerVersion, normalizeVersion } from "@media-app/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_CACHE_MS = 15 * 60 * 1000;
const REMOTE_FETCH_TIMEOUT_MS = 8_000;
const GIT_REMOTE_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = REMOTE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
  updateCheckWarning: string | null;
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
        if ((pkg.name === "media-app" || pkg.name === "reel") && fs.existsSync(updateScript)) {
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
  if (process.env.MEDIA_INSTALL_DIR?.trim()) {
    return process.env.MEDIA_INSTALL_DIR.trim();
  }
  if (process.env.REEL_INSTALL_DIR?.trim()) {
    return process.env.REEL_INSTALL_DIR.trim();
  }

  const fromCwd = findInstallDirFrom(process.cwd());
  if (fromCwd) return fromCwd;

  const fromModule = findInstallDirFrom(__dirname);
  if (fromModule) return fromModule;

  if (fs.existsSync("/opt/media-app/scripts/update.sh")) {
    return "/opt/media-app";
  }
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
  const mediaAppDir = path.join(os.homedir(), ".config/media-app");
  if (fs.existsSync(mediaAppDir)) return mediaAppDir;
  const legacyDir = path.join(os.homedir(), ".config/reel");
  if (fs.existsSync(legacyDir)) return legacyDir;
  return mediaAppDir;
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

const UPDATE_PHASE_RANK: Record<UpdatePhase, number> = {
  failed: -2,
  unknown: -1,
  preparing: 0,
  downloading: 1,
  building: 2,
  restarting: 3,
  complete: 4,
};

function maxUpdatePhase(a: UpdatePhase, b: UpdatePhase): UpdatePhase {
  if (a === "failed" || b === "failed") return "failed";
  return UPDATE_PHASE_RANK[a] >= UPDATE_PHASE_RANK[b] ? a : b;
}

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

  const activeIndex =
    phase === "unknown"
      ? 0
      : Math.max(0, UPDATE_STEP_ORDER.indexOf(phase));

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

const LOG_PHASE_PATTERNS: { phase: UpdatePhase; pattern: RegExp }[] = [
  { phase: "failed", pattern: /Update failed|media_progress "failed"|✗ Update failed/i },
  { phase: "complete", pattern: /Update complete|Update finished|upgraded to/i },
  {
    phase: "restarting",
    pattern:
      /\[4\] Restarting|Restarting via|Restarting media-app service|Restarting MEDIA! process|Stopping MEDIA!/i,
  },
  {
    phase: "building",
    pattern:
      /\[3\] Building|Installing dependencies and building|pnpm install|pnpm build|Tasks:\s+\d+ successful|Compiled successfully|next build|@media-app\/.*:build/i,
  },
  {
    phase: "downloading",
    pattern:
      /\[2\] Downloading|Checking out release|Fetching release|Pulling latest|Synced release|Synced latest|git fetch|git reset --hard|HEAD is now at/i,
  },
  { phase: "preparing", pattern: /\[1\] Checking install|Preparing update/i },
];

function readSessionStartedAt(): string | null {
  const logPath = getUpdateLogPath();
  if (!fs.existsSync(logPath)) return null;

  try {
    const raw = fs.readFileSync(logPath, "utf8");
    const lines = raw.split("\n").map((line) => stripAnsi(line).trim());

    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(/^--- Update started (.+?) \(/);
      if (match?.[1]) {
        const parsed = Date.parse(match[1]);
        if (Number.isFinite(parsed)) {
          return new Date(parsed).toISOString();
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function inferPhaseFromLog(lines: string[]): UpdatePhase {
  // Authoritative progress markers emitted by scripts/update.sh
  for (let i = lines.length - 1; i >= 0; i--) {
    const marker = lines[i].match(/REEL_UPDATE_PROGRESS phase=(\w+)/i);
    if (marker?.[1]) {
      const phase = marker[1].toLowerCase() as UpdatePhase;
      if (phase in UPDATE_STEP_LABELS) return phase;
    }
  }

  // Fall back to step output in the current session log tail.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    for (const { phase, pattern } of LOG_PHASE_PATTERNS) {
      if (pattern.test(line)) return phase;
    }
  }
  return "unknown";
}

function resolveUpdatePhase(filePhase: UpdatePhase, logLines: string[]): UpdatePhase {
  const logPhase = inferPhaseFromLog(logLines);
  return maxUpdatePhase(filePhase, logPhase);
}

function readLogTail(maxLines = 40): string[] {
  const logPath = getUpdateLogPath();
  if (!fs.existsSync(logPath)) return [];

  try {
    const raw = fs.readFileSync(logPath, "utf8");
    const allLines = raw
      .split("\n")
      .map((line) => stripAnsi(line).trim())
      .filter(Boolean);

    let sessionStart = 0;
    for (let i = allLines.length - 1; i >= 0; i--) {
      if (allLines[i].startsWith("--- Update started")) {
        sessionStart = i + 1;
        break;
      }
    }

    return allLines
      .slice(sessionStart)
      .filter(
        (line) =>
          !/^━+$/.test(line) &&
          line !== "MEDIA! — Update" &&
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
  startedAt?: string | null,
): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    getUpdateProgressPath(),
    JSON.stringify({
      phase,
      message,
      releaseTag,
      startedAt: startedAt ?? readLockMeta().startedAt ?? readSessionStartedAt(),
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function getUpdateProgress(): UpdateProgress | null {
  if (!isUpdateInProgress()) {
    return null;
  }

  const logTail = readLogTail();
  const { startedAt: lockStartedAt, releaseTag: lockTag } = readLockMeta();
  const sessionStartedAt = readSessionStartedAt();

  let phase: UpdatePhase = "unknown";
  let message = "Update in progress...";
  let releaseTag = lockTag;
  let updatedAt: string | null = null;
  let progressStartedAt: string | null = null;

  const progressPath = getUpdateProgressPath();
  if (fs.existsSync(progressPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(progressPath, "utf8")) as {
        phase?: UpdatePhase;
        message?: string;
        releaseTag?: string | null;
        updatedAt?: string;
        startedAt?: string;
      };
      if (parsed.phase) phase = parsed.phase;
      if (parsed.message) message = parsed.message;
      if (parsed.releaseTag) releaseTag = parsed.releaseTag;
      if (parsed.updatedAt) updatedAt = parsed.updatedAt;
      if (parsed.startedAt) progressStartedAt = parsed.startedAt;
    } catch {
      // fall through to log inference
    }
  }

  const resolvedPhase = resolveUpdatePhase(phase, logTail);
  phase = resolvedPhase;

  // The lock file stays until the update script exits; never show "complete"
  // while it is still held, even if stale log lines were misread.
  if (phase === "complete") {
    phase = "restarting";
  }

  let fileMessage: string | null = null;
  let filePhase: UpdatePhase | null = null;
  if (fs.existsSync(progressPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(progressPath, "utf8")) as {
        phase?: UpdatePhase;
        message?: string;
      };
      filePhase = parsed.phase ?? null;
      fileMessage = parsed.message?.trim() || null;
    } catch {
      // ignore
    }
  }

  if (fileMessage && filePhase === phase) {
    message = fileMessage;
  } else if (
    message === "Update in progress..." ||
    message === "Starting update..." ||
    filePhase !== phase
  ) {
    message = UPDATE_STEP_LABELS[phase] ?? message;
  }

  const startedAt = lockStartedAt ?? sessionStartedAt ?? progressStartedAt;
  const startedMs = startedAt ? Date.parse(startedAt) : null;
  const elapsedMs =
    startedMs != null && Number.isFinite(startedMs)
      ? Math.max(0, Date.now() - startedMs)
      : 0;

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
  return path.join(getConfigDir(), "updating.lock");
}

export function isUpdateInProgress(): boolean {
  return fs.existsSync(getUpdateLockPath());
}

function isUpdateSupported(installDir: string): boolean {
  const updateScript = path.join(installDir, "scripts/update.sh");
  return fs.existsSync(updateScript) && fs.existsSync(installDir);
}

async function fetchLatestReleaseFromGitHubApi(): Promise<GitHubRelease | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": `MEDIA/${getCurrentVersion()}`,
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchWithTimeout(GITHUB_API, { headers });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const detail = body?.message ?? `HTTP ${res.status}`;
    throw new Error(`GitHub API error: ${detail}`);
  }

  const release = (await res.json()) as GitHubRelease;
  if (release.draft || release.prerelease) {
    return null;
  }

  return release;
}

function fetchLatestTagFromGit(installDir: string): string | null {
  if (!fs.existsSync(path.join(installDir, ".git"))) {
    return null;
  }

  try {
    execFileSync(
      "git",
      ["-C", installDir, "remote", "set-url", "origin", `https://github.com/${GITHUB_REPO}.git`],
      { stdio: "ignore" },
    );
    return parseLatestTagFromLsRemote(
      execFileSync(
        "git",
        ["-C", installDir, "ls-remote", "--tags", "origin"],
        {
          encoding: "utf8",
          timeout: GIT_REMOTE_TIMEOUT_MS,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
      ),
    );
  } catch {
    return null;
  }
}

/** Latest semver tag from GitHub — works even when the install dir is not a git clone. */
function fetchLatestTagRemote(): string | null {
  try {
    const stdout = execFileSync(
      "git",
      ["ls-remote", "--tags", `https://github.com/${GITHUB_REPO}.git`],
      {
        encoding: "utf8",
        timeout: GIT_REMOTE_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    return parseLatestTagFromLsRemote(stdout);
  } catch {
    return null;
  }
}

function parseLatestTagFromLsRemote(stdout: string): string | null {
  const versions = stdout
    .split("\n")
    .map((line) => line.match(/refs\/tags\/v?(\d+\.\d+\.\d+)/)?.[1])
    .filter((value): value is string => Boolean(value));

  const unique = [...new Set(versions)];
  unique.sort((a, b) => compareVersions(b, a));
  return unique[0] ?? null;
}

function extractChangelogSection(markdown: string, version: string): string | null {
  const escaped = version.replace(/\./g, "\\.");
  const header = new RegExp(`^##\\s+${escaped}\\s*(?:—|-).*?$`, "m");
  const match = markdown.match(header);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextHeader = rest.search(/^##\s+\d+\.\d+\.\d+/m);
  const section = (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
  return section || null;
}

async function fetchReleaseNotesFromChangelog(version: string): Promise<string | null> {
  const tag = `v${version}`;
  const urls = [
    `https://raw.githubusercontent.com/${GITHUB_REPO}/${tag}/CHANGELOG.md`,
    `https://raw.githubusercontent.com/${GITHUB_REPO}/main/CHANGELOG.md`,
  ];

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { "User-Agent": `MEDIA/${getCurrentVersion()}` },
      });
      if (!res.ok) continue;

      const markdown = await res.text();
      const section = extractChangelogSection(markdown, version);
      if (section) return section;
    } catch {
      // try next URL
    }
  }

  return null;
}

function resolveLatestFromTags(
  installDir: string,
  currentVersion: string,
): {
  latestVersion: string;
  latestReleaseName: string;
  releaseUrl: string;
  updateAvailable: boolean;
} | null {
  const latest = fetchLatestTagFromGit(installDir) ?? fetchLatestTagRemote();
  if (!latest) {
    return null;
  }

  return {
    latestVersion: latest,
    latestReleaseName: `v${latest}`,
    releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/v${latest}`,
    updateAvailable: isNewerVersion(latest, currentVersion),
  };
}

export async function checkForUpdates(
  force = false,
  options: { includeReleaseNotes?: boolean } = {},
): Promise<UpdateStatus> {
  const includeReleaseNotes = options.includeReleaseNotes !== false;
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
    !updateInProgress &&
    cachedCheck &&
    Date.now() - cachedCheck.at < CHECK_CACHE_MS &&
    cachedCheck.status.currentVersion === currentVersion
  ) {
    return finalize({
      ...cachedCheck.status,
      updateInProgress,
      updateSupported,
      updateCheckWarning: cachedCheck.status.updateCheckWarning ?? null,
    });
  }

  let latestVersion: string | null = null;
  let latestReleaseName: string | null = null;
  let releaseUrl: string | null = null;
  let releaseNotes: string | null = null;
  let publishedAt: string | null = null;
  let updateAvailable = false;
  let updateCheckWarning: string | null = null;

  const tagLatest = resolveLatestFromTags(installDir, currentVersion);
  if (tagLatest) {
    latestVersion = tagLatest.latestVersion;
    latestReleaseName = tagLatest.latestReleaseName;
    releaseUrl = tagLatest.releaseUrl;
    updateAvailable = tagLatest.updateAvailable;
    if (includeReleaseNotes) {
      releaseNotes = await fetchReleaseNotesFromChangelog(tagLatest.latestVersion);
    }
  } else {
    try {
      const release = await fetchLatestReleaseFromGitHubApi();
      if (release) {
        latestVersion = normalizeVersion(release.tag_name);
        latestReleaseName = release.name || release.tag_name;
        releaseUrl = release.html_url;
        releaseNotes = release.body?.trim() || null;
        publishedAt = release.published_at;
        updateAvailable = isNewerVersion(latestVersion, currentVersion);
      }
    } catch (err) {
      updateCheckWarning =
        err instanceof Error ? err.message : "Update check failed";
    }
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
    updateCheckWarning,
  });

  cachedCheck = { at: Date.now(), status: { ...status, updateProgress: null } };
  return status;
}

export function normalizeReleaseTag(releaseTag: string): string {
  const trimmed = releaseTag.trim();
  const version = normalizeVersion(trimmed.replace(/^v/i, ""));
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Invalid release tag");
  }
  return `v${version}`;
}

/** Fast validation for in-app apply — avoids changelog/GitHub fetches before responding. */
export function prepareUpdateApply(requestedTag?: string | null): {
  releaseTag: string;
  installDir: string;
  currentVersion: string;
} {
  if (isUpdateInProgress()) {
    throw new Error("An update is already in progress");
  }

  const installDir = detectInstallDir();
  if (!isUpdateSupported(installDir)) {
    throw new Error("In-app updates are not supported on this install");
  }

  const currentVersion = getCurrentVersion(installDir);
  let releaseTag = requestedTag?.trim() || null;

  if (!releaseTag) {
    const tagLatest = resolveLatestFromTags(installDir, currentVersion);
    if (!tagLatest?.updateAvailable) {
      throw new Error("No release available to install");
    }
    releaseTag = tagLatest.latestReleaseName;
  }

  releaseTag = normalizeReleaseTag(releaseTag);
  const targetVersion = normalizeVersion(releaseTag.slice(1));

  if (!isNewerVersion(targetVersion, currentVersion)) {
    throw new Error("You are already on the latest release");
  }

  return { releaseTag, installDir, currentVersion };
}

export function triggerUpdate(releaseTag: string, installDir = detectInstallDir()): void {
  if (isUpdateInProgress()) {
    throw new Error("An update is already in progress");
  }

  const updateScript = path.join(installDir, "scripts/update.sh");
  if (!fs.existsSync(updateScript)) {
    throw new Error("Update script not found on this server");
  }

  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  const logPath = path.join(configDir, "update.log");
  const startedMs = Date.now();
  fs.writeFileSync(getUpdateLockPath(), `${startedMs}\n${releaseTag}\n`);
  fs.appendFileSync(logPath, `\n--- Update started ${new Date(startedMs).toISOString()} (${releaseTag}) ---\n`);
  writeUpdateProgress("preparing", "Starting update...", releaseTag, new Date(startedMs).toISOString());

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
      MEDIA_NONINTERACTIVE: "1",
      REEL_NONINTERACTIVE: "1",
      MEDIA_RELEASE_TAG: releaseTag,
      REEL_RELEASE_TAG: releaseTag,
      MEDIA_INSTALL_DIR: installDir,
      REEL_INSTALL_DIR: installDir,
      MEDIA_REPO: `https://github.com/${GITHUB_REPO}.git`,
      REEL_REPO: `https://github.com/${GITHUB_REPO}.git`,
      GIT_TERMINAL_PROMPT: "0",
      HOME: home,
      PATH: pathEnv,
    },
  });

  child.unref();
  fs.closeSync(logFd);
}
