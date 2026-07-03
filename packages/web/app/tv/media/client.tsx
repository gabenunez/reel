"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Loader2, Play } from "lucide-react";
import { api } from "@/lib/api";
import { tvRoutes } from "@/lib/tv/routes";
import { TvFocusButton, TvFocusLink } from "@/components/tv/tv-focus-link";
import { TvFavoriteButton } from "@/components/tv/tv-favorite-button";
import { ThemeMusicPlayer } from "@/components/theme-music-player";
import { formatDuration, getPlaybackButtonLabel } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/use-document-title";

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
  isFavorite?: boolean;
  hasThemeMusic?: boolean;
  watchProgress?: { positionMs: number; durationMs?: number | null } | null;
  files?: Array<{ id: number; durationMs?: number | null }>;
  seasons?: Season[];
}

export function TvMediaClient() {
  const searchParams = useSearchParams();
  const mediaId = parseInt(searchParams.get("id") ?? "", 10);
  const [media, setMedia] = useState<MediaDetail | null>(null);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [loading, setLoading] = useState(true);

  useDocumentTitle(media?.title ?? null);

  useEffect(() => {
    if (!mediaId || Number.isNaN(mediaId)) return;
    setLoading(true);
    api
      .getMedia(mediaId)
      .then((data) => setMedia(data as unknown as MediaDetail))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [mediaId]);

  useEffect(() => {
    if (loading || !media) return;
    const first = document.querySelector<HTMLElement>("[data-tv-item]");
    first?.focus();
  }, [loading, media, selectedSeason]);

  if (!mediaId || Number.isNaN(mediaId)) {
    return (
      <div className="px-8 py-24 text-center">
        <p className="mb-6 text-lg text-muted-foreground">Invalid media</p>
        <TvFocusLink href={tvRoutes.home()} className="inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">
          Back to home
        </TvFocusLink>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="px-8 py-24 text-center">
        <p className="mb-6 text-lg text-muted-foreground">Not found</p>
        <TvFocusLink href={tvRoutes.home()} className="inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">
          Back to home
        </TvFocusLink>
      </div>
    );
  }

  const backdropUrl = api.imageUrl(media.backdropPath ?? media.posterPath);
  const posterUrl = api.imageUrl(media.posterPath);
  const seasons = media.seasons ?? [];
  const episodes = seasons[selectedSeason]?.episodes ?? [];
  const movieFile = media.files?.[0];
  const moviePlaybackLabel = movieFile
    ? getPlaybackButtonLabel(
        media.watchProgress?.positionMs,
        media.watchProgress?.durationMs ?? movieFile.durationMs,
      )
    : "Play";

  return (
    <div>
      {media.hasThemeMusic && <ThemeMusicPlayer mediaId={media.id} />}
      <section className="relative overflow-hidden border-b border-border/70">
        {backdropUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {!backdropUrl && <div className="signal-grid absolute inset-0" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-transparent" />

        <div className="relative px-8 pb-10 pt-8">
          <TvFocusLink
            href={tvRoutes.home()}
            className="mb-8 inline-flex h-14 items-center gap-2 rounded-xl bg-background/60 px-5 text-base font-medium backdrop-blur"
          >
            <ChevronLeft className="h-6 w-6" /> Back
          </TvFocusLink>

          <div className="flex flex-col gap-8 lg:flex-row lg:items-end">
            <div className="w-44 shrink-0 lg:w-52">
              {posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={posterUrl}
                  alt={media.title}
                  className="w-full rounded-xl border border-white/10 poster-shadow"
                />
              ) : (
                <div className="signal-grid aspect-[2/3] rounded-xl border border-border bg-muted" />
              )}
            </div>

            <div className="max-w-4xl flex-1">
              <p className="mb-2 text-sm uppercase tracking-wide text-primary">
                {media.type === "movie" ? "Movie" : "Series"}
                {media.year ? ` · ${media.year}` : ""}
              </p>
              <h1 className="mb-4 text-4xl font-black sm:text-5xl">{media.title}</h1>
              {media.overview && (
                <p className="mb-6 max-w-3xl text-lg leading-relaxed text-muted-foreground line-clamp-4">
                  {media.overview}
                </p>
              )}

              <div data-tv-row="" className="flex flex-wrap items-center gap-4">
                {media.type === "movie" && movieFile && (
                  <TvFocusLink
                    href={tvRoutes.watch("movie", movieFile.id, media.id)}
                    className="inline-flex items-center gap-3 rounded-xl bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground"
                  >
                    <Play className="h-6 w-6 fill-current" /> {moviePlaybackLabel}
                  </TvFocusLink>
                )}
                <TvFavoriteButton mediaId={media.id} initialFavorite={media.isFavorite} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {media.type === "tv" && seasons.length > 0 && (
        <section className="px-8 py-8">
          <div
            data-tv-row=""
            className="scrollbar-hide mb-8 flex gap-3 overflow-x-auto pb-2"
          >
            {seasons.map((season, idx) => (
              <TvFocusButton
                key={season.id}
                onClick={() => setSelectedSeason(idx)}
                className={
                  selectedSeason === idx
                    ? "shrink-0 rounded-xl bg-primary px-5 py-3 text-base font-semibold text-primary-foreground"
                    : "shrink-0 rounded-xl border border-border bg-card px-5 py-3 text-base font-medium"
                }
              >
                {season.name ?? `Season ${season.seasonNumber}`}
              </TvFocusButton>
            ))}
          </div>

          <div className="space-y-3">
            {episodes.map((ep) => {
              const episodeActionLabel = getPlaybackButtonLabel(
                ep.watchProgress?.positionMs,
                ep.watchProgress?.durationMs ?? ep.durationMs,
              );

              return (
              <div key={ep.id} data-tv-row="" className="flex">
                <TvFocusLink
                  href={tvRoutes.watch("episode", ep.id, media.id)}
                  className="flex w-full items-center gap-5 rounded-xl border border-border/80 bg-card/70 p-4"
                >
                  <div className="relative flex h-20 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
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
                    {ep.watchProgress && ep.watchProgress.positionMs > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
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
                    <p className="text-lg font-semibold">
                      <span className="mr-2 font-mono text-sm text-primary">
                        E{String(ep.episodeNumber).padStart(2, "0")}
                      </span>
                      {ep.title ?? `Episode ${ep.episodeNumber}`}
                    </p>
                    {ep.overview && (
                      <p className="mt-1 line-clamp-2 text-base text-muted-foreground">
                        {ep.overview}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-sm text-muted-foreground">
                    {episodeActionLabel === "Play" && ep.durationMs
                      ? formatDuration(ep.durationMs)
                      : episodeActionLabel}
                  </span>
                </TvFocusLink>
              </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
