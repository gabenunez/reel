"use client";

import { Suspense, useEffect, useState } from "react";
import { useMediaRouteId } from "@/lib/use-route-params";
import { useIsClient } from "@/lib/use-browser-pathname";
import Link from "next/link";
import { Calendar, ChevronLeft, Clock3, Layers3, Play, Star } from "lucide-react";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaRow } from "@/components/media-row";
import { FavoriteButton } from "@/components/favorite-button";
import { ThemeMusicProvider, ThemeMusicWaveform } from "@/components/theme-music-player";
import { ThemeMusicMuteButton } from "@/components/theme-music-settings";
import { formatDuration, getPlaybackButtonLabel } from "@/lib/utils";
import { resolveActiveSeasonIndex } from "@/lib/playback-utils";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTvMode } from "@/lib/tv-mode";
import { TvMediaView } from "@/components/tv/views/media-view";
import { useMediaPageData } from "@/lib/use-media-page-data";

interface MovieFile {
  id: number;
  filePath: string;
  durationMs?: number | null;
}

interface Episode {
  id: number;
  episodeNumber: number;
  title?: string | null;
  overview?: string | null;
  durationMs?: number | null;
  stillPath?: string | null;
  watchProgress?: { positionMs: number; durationMs?: number | null } | null;
}

interface Season {
  id: number;
  seasonNumber: number;
  name?: string | null;
  episodes: Episode[];
}

interface MediaDetail {
  id: number;
  title: string;
  overview?: string | null;
  year?: number | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  type: "movie" | "tv";
  genres?: string | null;
  rating?: number | null;
  isFavorite?: boolean;
  hasThemeMusic?: boolean;
  watchProgress?: { positionMs: number; durationMs?: number | null } | null;
  files?: MovieFile[];
  seasons?: Season[];
}

export function MediaPageSkeleton() {
  return (
    <div>
      <Skeleton className="h-80 w-full" />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-24 w-full max-w-2xl" />
      </div>
    </div>
  );
}

export function MediaClient({
  mediaId: mediaIdProp,
  initialMedia,
}: {
  mediaId?: number;
  initialMedia?: Record<string, unknown>;
} = {}) {
  const isTvMode = useTvMode();
  const hasResolvedId = mediaIdProp != null && Number.isFinite(mediaIdProp);

  if (hasResolvedId) {
    if (isTvMode) {
      return (
        <TvMediaView
          key={mediaIdProp}
          mediaId={mediaIdProp}
          initialMedia={initialMedia}
        />
      );
    }
    return (
      <MediaDesktopClient
        key={mediaIdProp}
        mediaId={mediaIdProp}
        initialMedia={initialMedia}
      />
    );
  }

  return (
    <Suspense fallback={<MediaPageSkeleton />}>
      {isTvMode ? <TvMediaView /> : <MediaDesktopLegacyClient />}
    </Suspense>
  );
}

function MediaDesktopLegacyClient() {
  const isClient = useIsClient();
  const mediaId = useMediaRouteId();

  if (!mediaId || Number.isNaN(mediaId)) {
    if (!isClient) return <MediaPageSkeleton />;
    return (
      <div className="py-20 text-center">
        <p>Invalid media</p>
        <Button asChild className="mt-4">
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  return <MediaDesktopClient mediaId={mediaId} />;
}

function MediaDesktopClient({
  mediaId,
  initialMedia,
}: {
  mediaId: number;
  initialMedia?: Record<string, unknown>;
}) {
  const { media: mediaRecord, related, loading } = useMediaPageData(mediaId, initialMedia);
  const media = mediaRecord as MediaDetail | null;
  const [selectedSeason, setSelectedSeason] = useState(0);

  useDocumentTitle(media?.title ?? null);

  useEffect(() => {
    if (!media) {
      setSelectedSeason(0);
      return;
    }
    if (media.type === "tv" && media.seasons?.length) {
      setSelectedSeason(resolveActiveSeasonIndex(media.seasons));
    } else {
      setSelectedSeason(0);
    }
  }, [media]);

  if (loading && !media) {
    return <MediaPageSkeleton />;
  }

  if (!media) {
    return (
      <div className="py-20 text-center">
        <p>Media not found</p>
        <Button asChild className="mt-4">
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  const backdropUrl = api.imageUrl(media.backdropPath ?? media.posterPath);
  const posterUrl = api.imageUrl(media.posterPath);
  const movieFile = media.files?.[0];
  const moviePlaybackLabel = movieFile
    ? getPlaybackButtonLabel(
        media.watchProgress?.positionMs,
        media.watchProgress?.durationMs ?? movieFile.durationMs,
      )
    : "Play";

  const page = (
    <div>
      {media.hasThemeMusic && (
        <ThemeMusicMuteButton className="fixed top-20 right-4 z-50 sm:right-6" />
      )}
      <section className="relative overflow-hidden border-b border-border/70">
        {backdropUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdropUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
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
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={posterUrl}
                  alt={media.title}
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
              <h1 className="mb-4 text-4xl font-black sm:text-6xl">
                {media.title}
              </h1>

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

      {media.type === "tv" && media.seasons && (
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={api.imageUrl(ep.stillPath) ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
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
      )}

      {related.length > 0 && (
        <section className="border-t border-border/70 pb-12 pt-10">
          <MediaRow
            title={media.type === "movie" ? "More films in your library" : "More series in your library"}
            items={related}
          />
        </section>
      )}
    </div>
  );

  return media.hasThemeMusic ? (
    <ThemeMusicProvider mediaId={media.id}>{page}</ThemeMusicProvider>
  ) : (
    page
  );
}
