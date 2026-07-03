import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  entries: BrowseEntry[];
  exists: boolean;
  isDirectory: boolean;
}

function resolveBrowsePath(input?: string): string {
  if (!input || input.trim() === "") {
    return os.homedir();
  }
  return path.resolve(input.trim());
}

export function browseDirectory(requestedPath?: string): BrowseResult {
  const current = resolveBrowsePath(requestedPath);

  let exists = false;
  let isDirectory = false;

  try {
    const stat = fs.statSync(current);
    exists = true;
    isDirectory = stat.isDirectory();
  } catch {
    exists = false;
  }

  if (!exists || !isDirectory) {
    const parent = path.dirname(current);
    return {
      current,
      parent: parent !== current ? parent : null,
      entries: [],
      exists,
      isDirectory: false,
    };
  }

  const parent = path.dirname(current);
  let entries: BrowseEntry[] = [];

  try {
    entries = fs
      .readdirSync(current, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        if (entry.name.startsWith(".")) return false;
        return true;
      })
      .map((entry) => ({
        name: entry.name,
        path: path.join(current, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch {
    entries = [];
  }

  return {
    current,
    parent: parent !== current ? parent : null,
    entries,
    exists: true,
    isDirectory: true,
  };
}

export function validateLibraryPath(folderPath: string): {
  valid: boolean;
  error?: string;
  resolvedPath?: string;
} {
  const resolved = path.resolve(folderPath.trim());

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { valid: false, error: "Path must be a folder" };
    }
    fs.accessSync(resolved, fs.constants.R_OK);
    return { valid: true, resolvedPath: resolved };
  } catch {
    return { valid: false, error: "Folder does not exist or is not readable" };
  }
}
