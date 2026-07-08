"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { formatDuration, getPlaybackButtonLabel } from "@/lib/utils";
import { resolveActiveSeasonIndex } from "@/lib/playback-utils";
import { MediaImage } from "@/components/media-image";
import type { MediaDetail } from "./types";

export function MediaDesktopSeasons({ media }: { media: MediaDetail }) {
  const [selectedSeason, setSelectedSeason] = useState(0);

  useEffect(() => {
    if (media.type === "tv" && media.seasons?.length) {
      setSelectedSeason(resolveActiveSeasonIndex(media.seasons));
    } else {
      setSelectedSeason(0);
    }
  }, [media]);

  if (media.type !== "tv" || !media.seasons?.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="scrollbar-hide mb-6 flex gap-2 overflow-x-auto">
        {media.seasons.map((season, idx) => (
          <Button
            key={season.id}
            variant={selectedSeason === idx ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedSeason(idx)}
          >
            {season.name ?? `Season ${season.seasonNumber}`}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {media.seasons[selectedSeason]?.episodes.map((ep) => {
          const episodeActionLabel = getPlaybackButtonLabel(
            ep.watchProgress?.positionMs,
            ep.watchProgress?.durationMs ?? ep.durationMs,
          );

          return (
            <Link
              key={ep.id}
              href={routes.watch("episode", ep.id, media.id)}
              className="group relative flex items-center gap-4 overflow-hidden rounded-md border border-border/80 bg-card/70 p-3 transition-all hover:border-primary/50 hover:bg-card sm:p-4"
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-primary/0 transition-colors group-hover:bg-primary" />
              <div className="relative flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {ep.stillPath ? (
                  <MediaImage
                    src={api.imageUrl(ep.stillPath)}
                    alt=""
                    fill
                    sizes="7rem"
                    className="object-cover"
                  />
                ) : (
                  <span className="font-mono text-2xl font-bold text-muted-foreground">
                    {String(ep.episodeNumber).padStart(2, "0")}
                  </span>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-8 w-8 fill-white text-white" />
                </div>
                {ep.watchProgress && ep.watchProgress.positionMs > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/30">
                    <div
                      className="h-full bg-accent"
                      style={{
                        width: `${Math.min(100, (ep.watchProgress.positionMs / (ep.durationMs ?? 1)) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <span className="mr-2 font-mono text-xs text-primary">
                    E{String(ep.episodeNumber).padStart(2, "0")}
                  </span>
                  {ep.title}
                </p>
                {ep.overview && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {ep.overview}
                  </p>
                )}
              </div>
              <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                {episodeActionLabel === "Play" && ep.durationMs
                  ? formatDuration(ep.durationMs)
                  : episodeActionLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
