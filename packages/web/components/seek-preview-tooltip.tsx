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
      (() => {
        const maxThumbWidth = 224;
        const scale = Math.min(1, maxThumbWidth / cue.width);
        const displayWidth = Math.round(cue.width * scale);
        const displayHeight = Math.round(cue.height * scale);

        return (
          <div className="max-w-full overflow-hidden rounded-lg border border-white/15 bg-black/90 shadow-2xl">
            <div
              className="overflow-hidden"
              style={{ width: displayWidth, height: displayHeight, maxWidth: "100%" }}
            >
              <div
                style={{
                  width: cue.width,
                  height: cue.height,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  backgroundImage: `url(${spriteUrl})`,
                  backgroundPosition: `-${cue.x}px -${cue.y}px`,
                  backgroundRepeat: "no-repeat",
                }}
              />
            </div>
            <p className="px-2 py-1 text-center font-mono text-xs tabular-nums text-white">
              {formatDuration(timeMs)}
            </p>
          </div>
        );
      })()
    ) : (
      <div className="rounded-lg border border-white/15 bg-black/90 px-2.5 py-1.5 font-mono text-xs tabular-nums text-white shadow-xl">
        {formatDuration(timeMs)}
      </div>
    );

  if (variant === "inline") {
    return (
      <div className="pointer-events-none flex w-full max-w-full justify-center overflow-hidden">
        {previewBody}
      </div>
    );
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
