"use client";

import Link from "next/link";
import { Calendar, ChevronLeft, Clock3, Layers3, Play, Star } from "lucide-react";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { FavoriteButton } from "@/components/favorite-button";
import { ThemeMusicWaveform } from "@/components/theme-music-player";
import { formatDuration, getPlaybackButtonLabel } from "@/lib/utils";
import { mediaImageUrl } from "@/lib/media-image-url";
import { MediaImage } from "@/components/media-image";
import type { MediaDetail } from "./types";

export function MediaHero({ media }: { media: MediaDetail }) {
  const backdropUrl = mediaImageUrl(media.backdropPath ?? media.posterPath);
  const posterUrl = mediaImageUrl(media.posterPath);
  const movieFile = media.files?.[0];
  const moviePlaybackLabel = movieFile
    ? getPlaybackButtonLabel(
        media.watchProgress?.positionMs,
        media.watchProgress?.durationMs ?? movieFile.durationMs,
      )
    : "Play";

  return (
    <section className="relative overflow-hidden border-b border-border/70">
      {backdropUrl && (
        <MediaImage
          src={backdropUrl}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      )}
      {!backdropUrl && <div className="signal-grid absolute inset-0" />}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-background/10" />
      {media.hasThemeMusic && (
        <ThemeMusicWaveform className="absolute inset-x-0 bottom-0 h-40 w-full [mask-image:linear-gradient(to_top,black_20%,transparent)]" />
      )}

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-10 pt-20 sm:px-6 sm:pt-28">
        <Button variant="ghost" size="sm" asChild className="mb-8">
          <Link href="/">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>

        <div className="grid gap-7 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
          <div className="w-36 sm:w-48">
            {posterUrl ? (
              <MediaImage
                src={posterUrl}
                alt={media.title}
                width={192}
                height={288}
                priority
                sizes="192px"
                className="w-full rounded-md border border-white/10 poster-shadow"
              />
            ) : (
              <div className="signal-grid aspect-[2/3] rounded-md border border-border bg-muted" />
            )}
          </div>

          <div className="max-w-4xl">
            <p className="mb-3 font-mono text-[0.68rem] uppercase text-primary">
              {media.type === "movie" ? "Film file" : "Series stack"}
            </p>
            <h1 className="mb-4 text-4xl font-black sm:text-6xl">{media.title}</h1>

            <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
              {media.year && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/55 px-2.5 py-1 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  {media.year}
                </span>
              )}
              {media.rating && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/55 px-2.5 py-1 text-muted-foreground">
                  <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                  {media.rating.toFixed(1)}
                </span>
              )}
              {media.type === "movie" && media.files?.[0]?.durationMs && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/55 px-2.5 py-1 text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5 text-primary" />
                  {formatDuration(media.files[0].durationMs)}
                </span>
              )}
              {media.genres && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/55 px-2.5 py-1 text-muted-foreground">
                  <Layers3 className="h-3.5 w-3.5 text-primary" />
                  {media.genres}
                </span>
              )}
            </div>

            {media.overview && (
              <p className="mb-7 max-w-3xl text-base leading-7 text-muted-foreground">
                {media.overview}
              </p>
            )}

            {media.type === "movie" && movieFile && (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" asChild>
                  <Link href={routes.watch("movie", movieFile.id, media.id)}>
                    <Play className="h-5 w-5 fill-current" /> {moviePlaybackLabel}
                  </Link>
                </Button>
                <FavoriteButton
                  mediaId={media.id}
                  initialFavorite={media.isFavorite}
                  size="lg"
                />
              </div>
            )}

            {media.type === "tv" && (
              <FavoriteButton
                mediaId={media.id}
                initialFavorite={media.isFavorite}
                size="lg"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
