"use client";

import { useTvMode } from "@/lib/tv-mode";
import { TvMediaView } from "@/components/tv/views/media-view";
import { MediaDesktopSeasons } from "./media-desktop-seasons";
import type { MediaDetail } from "./types";

export function MediaPageBody({ media }: { media: MediaDetail }) {
  const isTvMode = useTvMode();

  if (isTvMode) {
    return (
      <div data-tv-only>
        <TvMediaView media={media} />
      </div>
    );
  }

  return (
    <div data-web-only>
      <MediaDesktopSeasons media={media} />
    </div>
  );
}
