export type VideoDisplayMode = "fit" | "fill" | "stretch";

export const VIDEO_DISPLAY_MODE_ORDER: VideoDisplayMode[] = ["fit", "fill", "stretch"];

const STORAGE_KEY = "media-video-display-mode";

export function loadVideoDisplayMode(): VideoDisplayMode {
  if (typeof window === "undefined") return "fit";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "fit" || stored === "fill" || stored === "stretch") {
      return stored;
    }
  } catch {
    // private browsing / disabled storage
  }
  return "fit";
}

export function saveVideoDisplayMode(mode: VideoDisplayMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function cycleVideoDisplayMode(current: VideoDisplayMode): VideoDisplayMode {
  const index = VIDEO_DISPLAY_MODE_ORDER.indexOf(current);
  const next = VIDEO_DISPLAY_MODE_ORDER[(index + 1) % VIDEO_DISPLAY_MODE_ORDER.length];
  return next ?? "fit";
}

export function videoDisplayModeClass(mode: VideoDisplayMode): string {
  switch (mode) {
    case "fill":
      return "object-cover";
    case "stretch":
      return "object-fill";
    default:
      return "object-contain";
  }
}

export function videoDisplayModeLabel(mode: VideoDisplayMode): string {
  switch (mode) {
    case "fill":
      return "Fill screen";
    case "stretch":
      return "Stretch";
    default:
      return "Fit";
  }
}

export function videoDisplayModeHint(mode: VideoDisplayMode): string {
  switch (mode) {
    case "fill":
      return "Fill — zoom to cover, may crop edges";
    case "stretch":
      return "Stretch — fill screen, may distort";
    default:
      return "Fit — show full picture";
  }
}
