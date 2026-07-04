"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvFocusButton, TvFocusLink } from "@/components/tv/tv-focus-link";
import { TvFavoriteButton } from "@/components/tv/tv-favorite-button";
import { TvPageHeader, TvSectionLabel } from "@/components/tv/tv-page-header";
import { TvPoster } from "@/components/tv/tv-poster";
import { TvRow, tvScrollRowClassName } from "@/components/tv/tv-row";
import { ThemeMusicProvider, ThemeMusicWaveform } from "@/components/theme-music-player";
import { formatDuration, getPlaybackButtonLabel } from "@/lib/utils";
import { resolveNextEpisodeTarget } from "@/lib/playback-utils";
import { useDocumentTitle } from "@/lib/use-document-title";
import { focusEpisodeItem, focusFirstContentItem } from "@/lib/tv-focus";
import { cn } from "@/lib/utils";

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

export function TvMediaView() {
  const searchParams = useSearchParams();
  const mediaId = parseInt(searchParams.get("id") ?? "", 10);
  const [media, setMedia] = useState<MediaDetail | null>(null);
  const [related, setRelated] = useState<MediaItem[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [loading, setLoading] = useState(true);
  const nextEpisodeIdRef = useRef<number | null>(null);

  useDocumentTitle(media?.title ?? null);

  useEffect(() => {
    if (!mediaId || Number.isNaN(mediaId)) return;
    setLoading(true);
    setSelectedSeason(0);
    setRelated([]);
    nextEpisodeIdRef.current = null;

    Promise.all([
      api.getMedia(mediaId).then((data) => {
        const nextMedia = data as unknown as MediaDetail;
        setMedia(nextMedia);
        if (nextMedia.type === "tv" && nextMedia.seasons?.length) {
          const target = resolveNextEpisodeTarget(nextMedia.seasons);
          setSelectedSeason(target?.seasonIndex ?? 0);
          nextEpisodeIdRef.current = target?.episodeId ?? null;
        } else {
          setSelectedSeason(0);
          nextEpisodeIdRef.current = null;
        }
      }),
      api.getRelatedMedia(mediaId).then((data) => setRelated(data.items)),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [mediaId]);

  useEffect(() => {
    if (loading || !media) return;

    requestAnimationFrame(() => {
      const nextEpisodeId = nextEpisodeIdRef.current;
      if (media.type === "tv" && nextEpisodeId != null && focusEpisodeItem(nextEpisodeId)) {
        return;
      }
      focusFirstContentItem();
    });
  }, [loading, media]);

  if (!mediaId || Number.isNaN(mediaId)) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="mb-4 text-muted-foreground">Invalid media</p>
        <div data-tv-row="" data-tv-content-row="" className="flex justify-center">
          <TvFocusLink
            href={routes.home()}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Back to home
          </TvFocusLink>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="mb-4 text-muted-foreground">Not found</p>
        <div data-tv-row="" data-tv-content-row="" className="flex justify-center">
          <TvFocusLink
            href={routes.home()}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Back to home
          </TvFocusLink>
        </div>
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
  const typeLabel = media.type === "movie" ? "Movie" : "Series";
  const metaLabel = [typeLabel, media.year].filter(Boolean).join(" · ");

  const page = (
    <div className="pb-6">
      {/* Hero — compact cinematic strip, not a full desktop detail page */}
      <section className="relative mb-5 overflow-hidden">
        <div className="relative h-[30vh] min-h-[220px] max-h-[320px]">
          {backdropUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="signal-grid absolute inset-0" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/50 to-transparent" />
          {media.hasThemeMusic && (
            <ThemeMusicWaveform className="absolute inset-x-0 bottom-0 h-20 w-full [mask-image:linear-gradient(to_top,black_15%,transparent)]" />
          )}
        </div>

        <div className="relative z-10 -mt-[5.5rem] px-6 sm:-mt-24">
          <div className="flex gap-4 sm:gap-5">
            <div className="w-[6.5rem] shrink-0 sm:w-28">
              {posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={posterUrl}
                  alt=""
                  className="aspect-[2/3] w-full rounded-md poster-shadow"
                />
              ) : (
                <div className="signal-grid aspect-[2/3] w-full rounded-md bg-muted" />
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-end pb-1">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-primary">
                {metaLabel}
              </p>
              <h1 className="mb-2 line-clamp-2 text-xl font-black leading-tight sm:text-2xl">
                {media.title}
              </h1>
              {media.overview && (
                <p className="mb-3 line-clamp-2 text-sm leading-snug text-muted-foreground">
                  {media.overview}
                </p>
              )}

              {media.type === "movie" && movieFile && (
                <div
                  data-tv-row=""
                  data-tv-content-row=""
                  className="flex flex-wrap items-center gap-2 py-0.5"
                >
                  <TvFocusLink
                    href={routes.watch("movie", movieFile.id, media.id, media.posterPath)}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {moviePlaybackLabel}
                  </TvFocusLink>
                  <TvFavoriteButton
                    mediaId={media.id}
                    initialFavorite={media.isFavorite}
                    className="!gap-2 !px-4 !py-2.5 !text-sm"
                  />
                </div>
              )}

              {media.type === "tv" && (
                <div data-tv-row="" data-tv-content-row="" className="py-0.5">
                  <TvFavoriteButton
                    mediaId={media.id}
                    initialFavorite={media.isFavorite}
                    className="!gap-2 !px-4 !py-2.5 !text-sm"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {media.type === "tv" && seasons.length > 0 && (
        <section className="px-6">
          <TvSectionLabel>Seasons</TvSectionLabel>
          <div
            data-tv-row=""
            data-tv-content-row=""
            data-tv-scroll-row=""
            className={cn(tvScrollRowClassName, "mb-5 gap-3 px-6")}
          >
            {seasons.map((season, idx) => (
              <TvFocusButton
                key={season.id}
                variant="chip"
                selected={selectedSeason === idx}
                onClick={() => setSelectedSeason(idx)}
                className="px-4 py-2 text-sm"
              >
                {season.name ?? `Season ${season.seasonNumber}`}
              </TvFocusButton>
            ))}
          </div>

          <TvSectionLabel>
            Episodes
            {episodes.length > 0 ? ` · ${episodes.length}` : ""}
          </TvSectionLabel>
          <div
            data-tv-row=""
            data-tv-content-row=""
            data-tv-vertical=""
            className="flex flex-col gap-1.5"
          >
            {episodes.map((ep) => {
              const episodeActionLabel = getPlaybackButtonLabel(
                ep.watchProgress?.positionMs,
                ep.watchProgress?.durationMs ?? ep.durationMs,
              );
              const progressPct =
                ep.watchProgress && ep.watchProgress.positionMs > 0
                  ? Math.min(
                      100,
                      (ep.watchProgress.positionMs / (ep.durationMs ?? 1)) * 100,
                    )
                  : 0;

              return (
                <TvFocusLink
                  key={ep.id}
                  href={routes.watch(
                    "episode",
                    ep.id,
                    media.id,
                    ep.stillPath ?? media.posterPath,
                  )}
                  variant="card"
                  data-tv-episode-id={ep.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="relative h-[3.75rem] w-[6.75rem] shrink-0 overflow-hidden rounded-md bg-muted">
                    {ep.stillPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={api.imageUrl(ep.stillPath) ?? ""}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center font-mono text-base font-bold text-muted-foreground">
                        {String(ep.episodeNumber).padStart(2, "0")}
                      </div>
                    )}
                    {progressPct > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/25">
                        <div className="h-full bg-accent" style={{ width: `${progressPct}%` }} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      <span className="mr-1.5 font-mono text-xs text-primary">
                        {String(ep.episodeNumber).padStart(2, "0")}
                      </span>
                      {ep.title ?? `Episode ${ep.episodeNumber}`}
                    </p>
                    {ep.overview && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {ep.overview}
                      </p>
                    )}
                  </div>

                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {episodeActionLabel === "Play" && ep.durationMs
                      ? formatDuration(ep.durationMs)
                      : episodeActionLabel}
                  </span>
                </TvFocusLink>
              );
            })}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <TvRow
          title={
            media.type === "movie"
              ? "More films in your library"
              : "More series in your library"
          }
          className="mt-2"
        >
          {related.map((item) => (
            <TvPoster key={item.id} item={item} />
          ))}
        </TvRow>
      )}
    </div>
  );

  return media.hasThemeMusic ? (
    <ThemeMusicProvider mediaId={media.id}>{page}</ThemeMusicProvider>
  ) : (
    page
  );
}
