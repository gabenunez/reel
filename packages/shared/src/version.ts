export const GITHUB_REPO = "gabenunez/media-app";

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(".").map((part) => parseInt(part, 10) || 0);
  const pb = normalizeVersion(b).split(".").map((part) => parseInt(part, 10) || 0);
  const length = Math.max(pa.length, pb.length);

  for (let i = 0; i < length; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
