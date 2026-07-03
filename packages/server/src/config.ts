import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { AppConfig, LibraryConfig } from "@reel/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getProjectRoot(): string {
  return path.resolve(__dirname, "../..");
}

function configCandidates(): string[] {
  const candidates: string[] = [];
  let dir = process.cwd();

  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, "config.yaml"));
    candidates.push(path.join(dir, "config.yml"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const projectRoot = getProjectRoot();
  candidates.push(path.join(projectRoot, "config.yaml"));
  candidates.push(path.join(projectRoot, "config.yml"));
  candidates.push(path.join(projectRoot, "..", "config.yaml"));

  return candidates;
}

function normalizeConfig(raw: AppConfig, configDir: string): AppConfig {
  const config = { ...raw };

  if (!config.server) {
    config.server = { port: 8096, host: "0.0.0.0" };
  }
  if (!config.metadata) {
    config.metadata = { tmdb_api_key: "", language: "en-US" };
  }
  if (!config.metadata.language) {
    config.metadata.language = "en-US";
  }
  if (!config.transcoding) {
    config.transcoding = {
      enabled: true,
      hls_segment_duration: 6,
      cache_dir: "./data/transcode-cache",
    };
  }
  if (!config.data_dir) {
    config.data_dir = "./data";
  }
  if (!config.libraries) {
    config.libraries = [];
  }

  config.data_dir = path.resolve(configDir, config.data_dir);
  config.transcoding.cache_dir = path.resolve(
    configDir,
    config.transcoding.cache_dir,
  );

  for (const lib of config.libraries) {
    if (!path.isAbsolute(lib.path)) {
      lib.path = path.resolve(configDir, lib.path);
    }
  }

  fs.mkdirSync(config.data_dir, { recursive: true });
  fs.mkdirSync(path.join(config.data_dir, "cache", "images"), {
    recursive: true,
  });
  fs.mkdirSync(config.transcoding.cache_dir, { recursive: true });

  return config;
}

function toRelative(configDir: string, absolutePath: string): string {
  const rel = path.relative(configDir, absolutePath);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.startsWith(".") ? rel : `./${rel}`;
  }
  return absolutePath;
}

export function ensureConfigExists(): string {
  const existing = configCandidates().find((p) => fs.existsSync(p));
  if (existing) return existing;

  const configPath = path.join(getProjectRoot(), "config.yaml");
  const defaultConfig = `# Reel media server — settings can be managed in the web UI at /settings
server:
  port: 8096
  host: 0.0.0.0

libraries: []

metadata:
  tmdb_api_key: ""
  language: en-US

transcoding:
  enabled: true
  hls_segment_duration: 6
  cache_dir: ./data/transcode-cache

data_dir: ./data
`;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, defaultConfig, "utf-8");
  return configPath;
}

export class ConfigManager {
  private config!: AppConfig;
  readonly configPath: string;
  readonly configDir: string;

  constructor() {
    this.configPath = ensureConfigExists();
    this.configDir = path.dirname(this.configPath);
    this.reload();
  }

  reload(): AppConfig {
    const raw = fs.readFileSync(this.configPath, "utf-8");
    this.config = normalizeConfig(yaml.load(raw) as AppConfig, this.configDir);
    return this.config;
  }

  get(): AppConfig {
    return this.config;
  }

  setLibraries(libraries: LibraryConfig[]): void {
    this.config.libraries = libraries.map((lib) => ({
      ...lib,
      path: path.resolve(lib.path),
    }));
    this.save();
  }

  setTmdbApiKey(apiKey: string): void {
    this.config.metadata.tmdb_api_key = apiKey.trim();
    this.save();
  }

  save(): void {
    const payload = {
      server: this.config.server,
      libraries: this.config.libraries.map((lib) => ({
        name: lib.name,
        type: lib.type,
        path: lib.path,
      })),
      metadata: this.config.metadata,
      transcoding: {
        ...this.config.transcoding,
        cache_dir: toRelative(
          this.configDir,
          this.config.transcoding.cache_dir,
        ),
      },
      data_dir: toRelative(this.configDir, this.config.data_dir),
    };

    fs.writeFileSync(this.configPath, yaml.dump(payload, { lineWidth: 120 }), "utf-8");
    this.reload();
  }
}

export function loadConfig(): AppConfig {
  return new ConfigManager().get();
}

export function getDbPath(config: AppConfig): string {
  return path.join(config.data_dir, "reel.db");
}

export function getWebOutPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "packages/web/out"),
    path.resolve(process.cwd(), "../web/out"),
    path.resolve(process.cwd(), "out"),
    path.resolve(process.cwd(), "../../web/out"),
    path.join(getProjectRoot(), "../web/out"),
  ];

  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

export function getDefaultBrowsePath(): string {
  return os.homedir();
}

export function getBrowseShortcuts(): Array<{ label: string; path: string }> {
  const shortcuts = [{ label: "Home", path: os.homedir() }];

  if (process.platform === "darwin" && fs.existsSync("/Volumes")) {
    shortcuts.push({ label: "Volumes", path: "/Volumes" });
  }

  if (process.platform === "win32") {
    for (const drive of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drivePath = `${drive}:\\`;
      try {
        if (fs.existsSync(drivePath)) {
          shortcuts.push({ label: `${drive}:`, path: drivePath });
        }
      } catch {
        // ignore inaccessible drives
      }
    }
  } else if (fs.existsSync("/media")) {
    shortcuts.push({ label: "Media", path: "/media" });
  }

  shortcuts.push({ label: "Root", path: process.platform === "win32" ? "C:\\" : "/" });
  return shortcuts;
}
