/** Parse a cached TMDB image filename (e.g. `w500__abc123.jpg`) back to size + path. */
export function parseCachedImageFilename(
  filename: string,
): { size: string; imagePath: string } | null {
  const match = filename.match(/^(w\d+|original)(_.+)$/);
  if (!match) return null;

  const size = match[1]!;
  const suffix = match[2]!;
  const imagePath = suffix.replace(/_/g, "/");
  if (!imagePath.startsWith("/")) return null;

  return { size, imagePath };
}

/** Map standard cached sizes to HD tiers for TV / large displays. */
export function hdImageSizeForCached(size: string): string | null {
  if (size === "w500" || size === "w185" || size === "w342" || size === "w154") {
    return "w780";
  }
  if (size === "w1280" || size === "w780") {
    return "w1920";
  }
  return null;
}
