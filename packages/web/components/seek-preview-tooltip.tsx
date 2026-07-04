"use client";

import type { SeekThumbnailCue } from "@/lib/use-seek-thumbnails";
import { formatDuration } from "@/lib/utils";

interface SeekPreviewTooltipProps {
  percent: number;
  timeMs: number;
  cue: SeekThumbnailCue | null;
  spriteUrl: string | null;
  /** inline = centered in a dock slot; floating = above a timeline (default) */
  variant?: "inline" | "floating";
}

export function SeekPreviewTooltip({
  percent,
  timeMs,
  cue,
  spriteUrl,
  variant = "floating",
}: SeekPreviewTooltipProps) {
  const previewBody =
    cue && spriteUrl ? (
      <div className="overflow-hidden rounded border border-white/20 bg-black shadow-lg">
        <div
          style={{
            width: cue.width,
            height: cue.height,
            backgroundImage: `url(${spriteUrl})`,
            backgroundPosition: `-${cue.x}px -${cue.y}px`,
            backgroundRepeat: "no-repeat",
          }}
        />
        <p className="px-2 py-1 text-center font-mono text-xs tabular-nums text-white">
          {formatDuration(timeMs)}
        </p>
      </div>
    ) : (
      <div className="rounded border border-white/20 bg-background/95 px-2 py-1 font-mono text-xs tabular-nums text-white shadow-lg">
        {formatDuration(timeMs)}
      </div>
    );

  if (variant === "inline") {
    return <div className="pointer-events-none flex justify-center">{previewBody}</div>;
  }

  return (
    <div
      className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2"
      style={{ left: `${percent}%` }}
    >
      {previewBody}
    </div>
  );
}
