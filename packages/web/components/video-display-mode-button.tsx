"use client";

import { Expand, Proportions, StretchHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TvFocusButton } from "@/components/tv/tv-focus-link";
import { cn } from "@/lib/utils";
import {
  type VideoDisplayMode,
  videoDisplayModeHint,
  videoDisplayModeLabel,
} from "@/lib/video-display-mode";

function DisplayModeIcon({ mode, className }: { mode: VideoDisplayMode; className?: string }) {
  switch (mode) {
    case "fill":
      return <Expand className={className} />;
    case "stretch":
      return <StretchHorizontal className={className} />;
    default:
      return <Proportions className={className} />;
  }
}

interface VideoDisplayModeButtonProps {
  mode: VideoDisplayMode;
  onCycle: () => void;
  variant?: "desktop" | "tv";
  className?: string;
}

export function VideoDisplayModeButton({
  mode,
  onCycle,
  variant = "desktop",
  className,
}: VideoDisplayModeButtonProps) {
  const label = videoDisplayModeLabel(mode);
  const hint = videoDisplayModeHint(mode);

  if (variant === "tv") {
    return (
      <TvFocusButton
        variant="nav"
        onClick={onCycle}
        aria-label={`Display: ${label}. ${hint}`}
        title={hint}
        className={cn("h-11 w-11", className)}
      >
        <DisplayModeIcon mode={mode} className="h-5 w-5" />
      </TvFocusButton>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("watch-control-btn", className)}
      onClick={onCycle}
      aria-label={`Display: ${label}. ${hint}`}
      title={hint}
    >
      <DisplayModeIcon mode={mode} className="h-4 w-4" />
    </Button>
  );
}
