export type SubtitleSize = "small" | "medium" | "large" | "extra-large";
export type SubtitleFont = "default" | "serif" | "monospace";
export type SubtitleColor =
  | "white"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "magenta"
  | "red"
  | "black";
export type SubtitleOpacity = "25" | "50" | "75" | "100";
export type SubtitleBackground = "none" | "black" | "white";
export type SubtitleBackgroundOpacity = "0" | "25" | "50" | "75" | "100";
export type SubtitleEdge = "none" | "drop-shadow" | "outline";

import {
  nativeTvPlayerAvailable,
  setNativeSubtitleStyles,
} from "@/lib/android-bridge";

export interface SubtitleStyles {
  size: SubtitleSize;
  font: SubtitleFont;
  color: SubtitleColor;
  opacity: SubtitleOpacity;
  background: SubtitleBackground;
  backgroundOpacity: SubtitleBackgroundOpacity;
  edge: SubtitleEdge;
}

export const SUBTITLE_STYLES_KEY = "media-subtitle-styles";
export const SUBTITLE_STYLES_CHANGED_EVENT = "media-subtitle-styles-changed";
const SUBTITLE_CUE_STYLE_ID = "media-subtitle-cue-styles";

export const DEFAULT_SUBTITLE_STYLES: SubtitleStyles = {
  size: "large",
  font: "default",
  // White + outline is readable on dark and light video without user setup.
  color: "white",
  opacity: "100",
  background: "none",
  backgroundOpacity: "0",
  edge: "outline",
};

const COLOR_RGB: Record<SubtitleColor, [number, number, number]> = {
  white: [255, 255, 255],
  yellow: [255, 235, 59],
  green: [118, 255, 122],
  cyan: [77, 232, 255],
  blue: [130, 170, 255],
  magenta: [255, 128, 255],
  red: [255, 107, 107],
  black: [0, 0, 0],
};

const SIZE_EM: Record<SubtitleSize, string> = {
  small: "0.9em",
  medium: "1.05em",
  large: "1.3em",
  "extra-large": "1.6em",
};

const FONT_FAMILY: Record<SubtitleFont, string> = {
  default: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", serif',
  monospace: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
};

const EDGE_SHADOW: Record<SubtitleEdge, string> = {
  none: "none",
  "drop-shadow": "2px 2px 3px rgba(0, 0, 0, 0.9)",
  outline:
    "rgb(0 0 0) -1px -1px 0, rgb(0 0 0) 1px -1px 0, rgb(0 0 0) -1px 1px 0, rgb(0 0 0) 1px 1px 0",
};

const PLAYBACK_SIZE_CLAMP: Record<
  SubtitleSize,
  { min: string; fluid: number; max: string }
> = {
  small: { min: "1rem", fluid: 2.2, max: "1.35rem" },
  medium: { min: "1.15rem", fluid: 2.6, max: "1.6rem" },
  large: { min: "1.35rem", fluid: 3.1, max: "1.95rem" },
  "extra-large": { min: "1.55rem", fluid: 3.6, max: "2.3rem" },
};

/** ExoPlayer fractional text height on native TV (fraction of viewport height). */
const NATIVE_FRACTIONAL_SIZE: Record<SubtitleSize, number> = {
  small: 0.045,
  medium: 0.053,
  large: 0.065,
  "extra-large": 0.08,
};

export type SubtitleAppearanceSizeUnit = "vmin" | "cqmin" | "cqh";

export interface SubtitleCueAppearance {
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontFamily: string;
  textShadow: string;
  lineHeight: number;
  padding: string | undefined;
  borderRadius: string | undefined;
}

function subtitleSizeClamp(
  size: SubtitleSize,
  unit: Extract<SubtitleAppearanceSizeUnit, "vmin" | "cqmin">,
): string {
  const scale = PLAYBACK_SIZE_CLAMP[size];
  return `clamp(${scale.min}, ${scale.fluid}${unit}, ${scale.max})`;
}

function rgba(color: SubtitleColor, opacityPercent: string): string {
  const [r, g, b] = COLOR_RGB[color];
  const alpha = parseInt(opacityPercent, 10) / 100;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function cueBackground(styles: SubtitleStyles): string {
  if (styles.background === "none" || styles.backgroundOpacity === "0") {
    return "transparent";
  }
  return rgba(styles.background, styles.backgroundOpacity);
}

function isSubtitleStyles(value: unknown): value is SubtitleStyles {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SubtitleStyles>;
  return (
    typeof candidate.size === "string" &&
    typeof candidate.font === "string" &&
    typeof candidate.color === "string" &&
    typeof candidate.opacity === "string" &&
    typeof candidate.background === "string" &&
    typeof candidate.backgroundOpacity === "string" &&
    typeof candidate.edge === "string"
  );
}

export function readSubtitleStyles(): SubtitleStyles {
  if (typeof window === "undefined") return DEFAULT_SUBTITLE_STYLES;

  try {
    const raw = localStorage.getItem(SUBTITLE_STYLES_KEY);
    if (!raw) return DEFAULT_SUBTITLE_STYLES;
    const parsed = JSON.parse(raw) as unknown;
    if (!isSubtitleStyles(parsed)) return DEFAULT_SUBTITLE_STYLES;
    const styles = { ...DEFAULT_SUBTITLE_STYLES, ...parsed };
    // Legacy default was black-on-transparent (often invisible on dark video).
    if (styles.color === "black" && styles.background === "none") {
      styles.color = "white";
      try {
        writeSubtitleStyles(styles);
      } catch {
        // ignore quota / private mode
      }
    }
    return styles;
  } catch {
    return DEFAULT_SUBTITLE_STYLES;
  }
}

export function writeSubtitleStyles(styles: SubtitleStyles): void {
  localStorage.setItem(SUBTITLE_STYLES_KEY, JSON.stringify(styles));
}

export function applySubtitleStyles(styles: SubtitleStyles): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const color = rgba(styles.color, styles.opacity);
  const background = cueBackground(styles);
  const size = SIZE_EM[styles.size];
  const font = FONT_FAMILY[styles.font];
  const shadow = EDGE_SHADOW[styles.edge];

  root.style.setProperty("--subtitle-cue-size", size);
  root.style.setProperty("--subtitle-cue-font", font);
  root.style.setProperty("--subtitle-cue-color", color);
  root.style.setProperty("--subtitle-cue-background", background);
  root.style.setProperty("--subtitle-cue-shadow", shadow);

  // Browsers often cache ::cue styling and ignore live CSS variable updates.
  // Inject concrete rules so appearance changes apply immediately.
  let styleEl = document.getElementById(SUBTITLE_CUE_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = SUBTITLE_CUE_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    video.media-subtitles::cue {
      color: ${color};
      background-color: ${background};
      font-size: ${size};
      font-family: ${font};
      text-shadow: ${shadow};
      line-height: 1.35;
    }
    .tv-ui video.media-subtitles::cue {
      font-size: calc(${size} * 1.25);
      line-height: 1.4;
    }
    html.tv-mode.tv-4k .tv-ui video.media-subtitles::cue {
      font-size: calc(${size} * 1.35);
    }
  `;

  if (nativeTvPlayerAvailable()) {
    setNativeSubtitleStyles(styles);
  }
}

export function subtitleCueAppearance(
  styles: SubtitleStyles,
  options?: {
    sizeUnit?: Extract<SubtitleAppearanceSizeUnit, "vmin" | "cqmin">;
    nativeFractional?: boolean;
  },
): SubtitleCueAppearance {
  const backgroundColor = cueBackground(styles);
  const transparentBg = backgroundColor === "transparent";

  const fontSize = options?.nativeFractional
    ? `${NATIVE_FRACTIONAL_SIZE[styles.size] * 100}cqh`
    : subtitleSizeClamp(styles.size, options?.sizeUnit ?? "vmin");

  return {
    color: rgba(styles.color, styles.opacity),
    backgroundColor,
    fontSize,
    fontFamily: FONT_FAMILY[styles.font],
    textShadow: EDGE_SHADOW[styles.edge],
    lineHeight: 1.35,
    padding: transparentBg ? undefined : "0.2em 0.45em",
    borderRadius: transparentBg ? undefined : "0.2em",
  };
}

/** Mini player-frame preview (uses container query units). */
export function previewSubtitleAppearance(
  styles: SubtitleStyles,
  options?: { nativePlayback?: boolean },
): SubtitleCueAppearance {
  if (options?.nativePlayback) {
    return subtitleCueAppearance(styles, { nativeFractional: true });
  }

  const fluid = PLAYBACK_SIZE_CLAMP[styles.size].fluid;
  const backgroundColor = cueBackground(styles);
  const transparentBg = backgroundColor === "transparent";

  return {
    color: rgba(styles.color, styles.opacity),
    backgroundColor,
    fontSize: `${fluid}cqmin`,
    fontFamily: FONT_FAMILY[styles.font],
    textShadow: EDGE_SHADOW[styles.edge],
    lineHeight: 1.35,
    padding: transparentBg ? undefined : "0.2em 0.45em",
    borderRadius: transparentBg ? undefined : "0.2em",
  };
}

/** Live web playback overlay and ::cue variables. */
export function playbackSubtitleAppearance(styles: SubtitleStyles): SubtitleCueAppearance {
  return subtitleCueAppearance(styles, { sizeUnit: "vmin" });
}

export const SUBTITLE_SIZE_OPTIONS: Array<{ value: SubtitleSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "extra-large", label: "Extra Large" },
];

export const SUBTITLE_FONT_OPTIONS: Array<{ value: SubtitleFont; label: string }> = [
  { value: "default", label: "Default" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
];

export const SUBTITLE_COLOR_OPTIONS: Array<{ value: SubtitleColor; label: string }> = [
  { value: "white", label: "White" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "cyan", label: "Cyan" },
  { value: "blue", label: "Blue" },
  { value: "magenta", label: "Magenta" },
  { value: "red", label: "Red" },
  { value: "black", label: "Black" },
];

export const SUBTITLE_OPACITY_OPTIONS: Array<{ value: SubtitleOpacity; label: string }> = [
  { value: "100", label: "100%" },
  { value: "75", label: "75%" },
  { value: "50", label: "50%" },
  { value: "25", label: "25%" },
];

export const SUBTITLE_BACKGROUND_OPTIONS: Array<{ value: SubtitleBackground; label: string }> =
  [
    { value: "none", label: "None" },
    { value: "black", label: "Black" },
    { value: "white", label: "White" },
  ];

export const SUBTITLE_BACKGROUND_OPACITY_OPTIONS: Array<{
  value: SubtitleBackgroundOpacity;
  label: string;
}> = [
  { value: "100", label: "100%" },
  { value: "75", label: "75%" },
  { value: "50", label: "50%" },
  { value: "25", label: "25%" },
  { value: "0", label: "0%" },
];

export const SUBTITLE_EDGE_OPTIONS: Array<{ value: SubtitleEdge; label: string }> = [
  { value: "none", label: "None" },
  { value: "drop-shadow", label: "Drop Shadow" },
  { value: "outline", label: "Outline" },
];
