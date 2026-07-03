"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Play, Star, ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/utils";

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
  watchProgress?: { positionMs: number } | null;
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
  files?: MovieFile[];
  seasons?: Season[];
}

export function MediaClient() {
  const searchParams = useSearchParams();
  const mediaId = parseInt(searchParams.get("id") ?? "", 10);
  const [media, setMedia] = useState<MediaDetail | null>(null);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mediaId || Number.isNaN(mediaId)) return;
    api
      .getMedia(mediaId)
      .then((data) => setMedia(data as unknown as MediaDetail))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [mediaId]);

  if (!mediaId || Number.isNaN(mediaId)) {
    return (
      <div className="py-20 text-center">
        <p>Invalid media</p>
        <Button asChild className="mt-4">
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <Skeleton className="h-80 w-full" />
        <div className="mx-auto max-w-7xl px-6 py-10">
          <Skeleton className="mb-4 h-10 w-64" />
          <Skeleton className="h-24 w-full max-w-2xl" />
        </div>
      </div>
    );
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

  return (
    <div>
      <div className="relative h-72 overflow-hidden sm:h-96">
        {backdropUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdropUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 to-transparent" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="-mt-32 flex flex-col gap-6 sm:-mt-40 sm:flex-row">
          <div className="w-40 shrink-0 sm:w-48">
            {posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterUrl}
                alt={media.title}
                className="w-full rounded-xl poster-shadow"
              />
            ) : (
              <div className="aspect-[2/3] rounded-xl bg-secondary" />
            )}
          </div>

          <div className="flex-1 pt-4 sm:pt-16">
            <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
              <Link href="/">
                <ChevronLeft className="h-4 w-4" /> Back
              </Link>
            </Button>

            <h1 className="mb-2 text-3xl font-bold sm:text-4xl">
              {media.title}
              {media.year && (
                <span className="ml-2 text-xl text-muted-foreground">
                  ({media.year})
                </span>
              )}
            </h1>

            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {media.rating && (
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-primary text-primary" />
                  {media.rating.toFixed(1)}
                </span>
              )}
              {media.genres && <span>{media.genres}</span>}
              {media.type === "movie" && media.files?.[0]?.durationMs && (
                <span>{formatDuration(media.files[0].durationMs)}</span>
              )}
            </div>

            {media.overview && (
              <p className="mb-6 max-w-3xl text-muted-foreground leading-relaxed">
                {media.overview}
              </p>
            )}

            {media.type === "movie" && media.files?.[0] && (
              <Button size="lg" asChild>
                <Link href={routes.watch("movie", media.files[0].id, media.id)}>
                  <Play className="h-5 w-5 fill-current" /> Play
                </Link>
              </Button>
            )}
          </div>
        </div>

        {media.type === "tv" && media.seasons && (
          <div className="mt-12 pb-16">
            <div className="mb-6 flex gap-2 overflow-x-auto">
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

            <div className="space-y-2">
              {media.seasons[selectedSeason]?.episodes.map((ep) => (
                <Link
                  key={ep.id}
                  href={routes.watch("episode", ep.id, media.id)}
                  className="group flex items-center gap-4 rounded-xl border border-border bg-card/50 p-4 transition-all hover:border-primary/50 hover:bg-card"
                >
                  <div className="relative flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
                    {ep.stillPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={api.imageUrl(ep.stillPath) ?? ""}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl font-bold text-muted-foreground">
                        {ep.episodeNumber}
                      </span>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <Play className="h-8 w-8 fill-white text-white" />
                    </div>
                    {ep.watchProgress && ep.watchProgress.positionMs > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/30">
                        <div
                          className="h-full bg-primary"
                          style={{
                            width: `${Math.min(100, (ep.watchProgress.positionMs / (ep.durationMs ?? 1)) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {ep.episodeNumber}. {ep.title}
                    </p>
                    {ep.overview && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {ep.overview}
                      </p>
                    )}
                  </div>
                  {ep.durationMs && (
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {formatDuration(ep.durationMs)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
