export function formatReleaseDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function previewReleaseNotes(notes: string | null, maxLines = 6): string | null {
  if (!notes?.trim()) return null;
  return notes.trim().split("\n").slice(0, maxLines).join("\n");
}
