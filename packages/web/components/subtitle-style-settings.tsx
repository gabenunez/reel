"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TvFocusButton } from "@/components/tv/tv-focus-link";
import { tvScrollRowClassName } from "@/components/tv/tv-row";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SUBTITLE_STYLES,
  SUBTITLE_BACKGROUND_OPACITY_OPTIONS,
  SUBTITLE_BACKGROUND_OPTIONS,
  SUBTITLE_COLOR_OPTIONS,
  SUBTITLE_EDGE_OPTIONS,
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_OPACITY_OPTIONS,
  SUBTITLE_SIZE_OPTIONS,
  SUBTITLE_STYLES_CHANGED_EVENT,
  applySubtitleStyles,
  previewSubtitleStyles,
  readSubtitleStyles,
  writeSubtitleStyles,
  type SubtitleStyles,
} from "@/lib/subtitle-styles";

type SubtitleStylesContextValue = {
  styles: SubtitleStyles;
  setStyles: (styles: SubtitleStyles) => void;
  updateStyle: <K extends keyof SubtitleStyles>(key: K, value: SubtitleStyles[K]) => void;
  resetStyles: () => void;
};

const SubtitleStylesContext = createContext<SubtitleStylesContextValue>({
  styles: DEFAULT_SUBTITLE_STYLES,
  setStyles: () => {},
  updateStyle: () => {},
  resetStyles: () => {},
});

export function useSubtitleStyles() {
  return useContext(SubtitleStylesContext);
}

export function SubtitleStylesProvider({ children }: { children: ReactNode }) {
  const [styles, setStylesState] = useState(readSubtitleStyles);

  const setStyles = useCallback((next: SubtitleStyles) => {
    setStylesState(next);
    writeSubtitleStyles(next);
    applySubtitleStyles(next);
  }, []);

  const updateStyle = useCallback(
    <K extends keyof SubtitleStyles>(key: K, value: SubtitleStyles[K]) => {
      setStyles({ ...styles, [key]: value });
    },
    [setStyles, styles],
  );

  const resetStyles = useCallback(() => {
    setStyles(DEFAULT_SUBTITLE_STYLES);
  }, [setStyles]);

  useEffect(() => {
    applySubtitleStyles(styles);
  }, [styles]);

  useEffect(() => {
    const sync = () => {
      const next = readSubtitleStyles();
      setStylesState(next);
      applySubtitleStyles(next);
    };
    window.addEventListener(SUBTITLE_STYLES_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SUBTITLE_STYLES_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <SubtitleStylesContext.Provider value={{ styles, setStyles, updateStyle, resetStyles }}>
      {children}
    </SubtitleStylesContext.Provider>
  );
}

function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              value === option.value
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SubtitleAppearanceSettings() {
  const { styles, setStyles, updateStyle, resetStyles } = useSubtitleStyles();
  const preview = previewSubtitleStyles(styles);

  return (
    <div id="subtitle-appearance" className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        <div className="relative aspect-[16/5] bg-gradient-to-b from-zinc-900 to-black">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.08),transparent_55%)]" />
          <div className="absolute inset-x-0 bottom-[18%] flex justify-center px-6">
            <p
              className="max-w-xl text-center leading-snug"
              style={{
                color: preview.color,
                backgroundColor: preview.backgroundColor,
                fontSize: preview.fontSize,
                fontFamily: preview.fontFamily,
                textShadow: preview.textShadow,
                padding:
                  styles.background === "none" || styles.backgroundOpacity === "0"
                    ? "0"
                    : "0.2em 0.55em",
                borderRadius: "0.2em",
              }}
            >
              These are sample subtitles for preview.
            </p>
          </div>
        </div>
      </div>

      <OptionRow
        label="Text size"
        options={SUBTITLE_SIZE_OPTIONS}
        value={styles.size}
        onChange={(value) => updateStyle("size", value)}
      />

      <OptionRow
        label="Font"
        options={SUBTITLE_FONT_OPTIONS}
        value={styles.font}
        onChange={(value) => updateStyle("font", value)}
      />

      <OptionRow
        label="Text color"
        options={SUBTITLE_COLOR_OPTIONS}
        value={styles.color}
        onChange={(value) => updateStyle("color", value)}
      />

      <OptionRow
        label="Text opacity"
        options={SUBTITLE_OPACITY_OPTIONS}
        value={styles.opacity}
        onChange={(value) => updateStyle("opacity", value)}
      />

      <OptionRow
        label="Background"
        options={SUBTITLE_BACKGROUND_OPTIONS}
        value={styles.background}
        onChange={(value) => {
          const next = { ...styles, background: value };
          if (value === "none") {
            next.backgroundOpacity = "0";
          } else if (styles.backgroundOpacity === "0") {
            next.backgroundOpacity = "75";
          }
          setStyles(next);
        }}
      />

      <OptionRow
        label="Background opacity"
        options={SUBTITLE_BACKGROUND_OPACITY_OPTIONS}
        value={styles.backgroundOpacity}
        onChange={(value) => updateStyle("backgroundOpacity", value)}
        disabled={styles.background === "none"}
      />

      <OptionRow
        label="Text edge style"
        options={SUBTITLE_EDGE_OPTIONS}
        value={styles.edge}
        onChange={(value) => updateStyle("edge", value)}
      />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={resetStyles}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

export function SubtitleAppearanceSettingsLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/settings#subtitle-appearance"
      className="block w-full rounded px-3 py-1.5 text-left text-sm text-primary hover:bg-muted"
      onClick={onNavigate}
    >
      Subtitle appearance...
    </Link>
  );
}

function TvSubtitleOptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-sm font-medium text-muted-foreground">{label}</p>
      <div
        data-tv-row=""
        data-tv-content-row=""
        data-tv-scroll-row=""
        className={cn(tvScrollRowClassName, "gap-2 px-0 py-1")}
      >
        {options.map((option) => (
          <TvFocusButton
            key={option.value}
            variant="chip"
            selected={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="px-4 py-2 text-sm font-semibold"
          >
            {option.label}
          </TvFocusButton>
        ))}
      </div>
    </div>
  );
}

export function TvSubtitleAppearancePanel() {
  const { styles, setStyles, updateStyle, resetStyles } = useSubtitleStyles();
  const preview = previewSubtitleStyles(styles);

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-white/10 bg-black">
        <div className="relative aspect-[16/5] bg-gradient-to-b from-zinc-900 to-black">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.08),transparent_55%)]" />
          <div className="absolute inset-x-0 bottom-[18%] flex justify-center px-6">
            <p
              className="max-w-xl text-center leading-snug"
              style={{
                color: preview.color,
                backgroundColor: preview.backgroundColor,
                fontSize: preview.fontSize,
                fontFamily: preview.fontFamily,
                textShadow: preview.textShadow,
                padding:
                  styles.background === "none" || styles.backgroundOpacity === "0"
                    ? "0"
                    : "0.2em 0.55em",
                borderRadius: "0.2em",
              }}
            >
              These are sample subtitles for preview.
            </p>
          </div>
        </div>
      </div>

      <TvSubtitleOptionRow
        label="Text size"
        options={SUBTITLE_SIZE_OPTIONS}
        value={styles.size}
        onChange={(value) => updateStyle("size", value)}
      />

      <TvSubtitleOptionRow
        label="Font"
        options={SUBTITLE_FONT_OPTIONS}
        value={styles.font}
        onChange={(value) => updateStyle("font", value)}
      />

      <TvSubtitleOptionRow
        label="Text color"
        options={SUBTITLE_COLOR_OPTIONS}
        value={styles.color}
        onChange={(value) => updateStyle("color", value)}
      />

      <TvSubtitleOptionRow
        label="Text opacity"
        options={SUBTITLE_OPACITY_OPTIONS}
        value={styles.opacity}
        onChange={(value) => updateStyle("opacity", value)}
      />

      <TvSubtitleOptionRow
        label="Background"
        options={SUBTITLE_BACKGROUND_OPTIONS}
        value={styles.background}
        onChange={(value) => {
          const next = { ...styles, background: value };
          if (value === "none") {
            next.backgroundOpacity = "0";
          } else if (styles.backgroundOpacity === "0") {
            next.backgroundOpacity = "75";
          }
          setStyles(next);
        }}
      />

      <TvSubtitleOptionRow
        label="Background opacity"
        options={SUBTITLE_BACKGROUND_OPACITY_OPTIONS}
        value={styles.backgroundOpacity}
        onChange={(value) => updateStyle("backgroundOpacity", value)}
        disabled={styles.background === "none"}
      />

      <TvSubtitleOptionRow
        label="Text edge style"
        options={SUBTITLE_EDGE_OPTIONS}
        value={styles.edge}
        onChange={(value) => updateStyle("edge", value)}
      />

      <TvFocusButton
        variant="card"
        onClick={resetStyles}
        className="w-full rounded-xl px-4 py-3 text-left text-base"
      >
        Reset to defaults
      </TvFocusButton>
    </div>
  );
}
