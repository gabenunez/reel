"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clapperboard,
  HardDrive,
  Heart,
  Layers,
  Play,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { useScanStatus } from "@/components/scan-status-provider";
import { useDocumentTitle } from "@/lib/use-document-title";
import { ContinueWatchingRow, MediaRow } from "@/components/media-row";
import { ScanProgressBanner } from "@/components/scan-progress";
import { HomeHeroStatic, HomeHeroWatermark, HomeHeroMonitorFrame, HomeSectionHeading } from "@/components/home-shell";
import { PosterRowSkeleton } from "@/components/poster-row-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LibraryIcon } from "@/components/navbar";
import { cn } from "@/lib/utils";
import { useTvMode } from "@/lib/tv-mode";
import { TvHomeView } from "@/components/tv/views/home-view";
import { preloadPosterList, prefetchPosterNavigation } from "@/lib/prefetch-artwork";
import { MediaImage } from "@/components/media-image";
import type { HomeData } from "@/lib/server-api";

export function HomeClient({
  initialData = null,
}: {
  initialData?: HomeData | null;
}) {
  const isTvMode = useTvMode();
  if (isTvMode) return <TvHomeView initialData={initialData} />;
  return <HomeDesktopClient initialData={initialData} />;
}

function HomeDesktopClient({ initialData = null }: { initialData?: HomeData | null }) {
  useDocumentTitle("Home");
  const [data, setData] = useState<HomeData | null>(initialData);
  const [loaded, setLoaded] = useState(Boolean(initialData));
  const [featuredImageReady, setFeaturedImageReady] = useState(false);
  const { status, activeScan, isScanning } = useScanStatus();
  const wasScanningRef = useRef(false);

  useEffect(() => {
    if (initialData) return;
    api
      .getHome()
      .then(setData)
      .catch((err) => console.warn("Failed to load home data", err))
      .finally(() => setLoaded(true));
  }, [initialData]);

  useEffect(() => {
    if (isScanning) {
      wasScanningRef.current = true;
      return;
    }

    if (wasScanningRef.current) {
      api.getHome().then(setData).catch(console.error);
    }
    wasScanningRef.current = false;
  }, [isScanning]);

  const libraries = (data?.libraries ?? []).map((lib) => {
    const live = status?.libraries.find((entry) => entry.id === lib.id);
    return live ? { ...lib, itemCount: live.itemCount } : lib;
  });
  const decks = data?.decks ?? [];
  const recentlyAdded = data?.recentlyAdded ?? [];
  const favorites = data?.favorites ?? [];
  const continueWatching = data?.continueWatching ?? [];
  const continueTarget = continueWatching[0] ?? null;
  const featured = recentlyAdded[0];
  const continueHref =
    continueTarget != null
      ? routes.watch(
          continueTarget.itemType,
          continueTarget.itemId,
          continueTarget.mediaId,
        )
      : null;
  const featuredImage = api.imageUrl(featured?.backdropPath ?? featured?.posterPath);
  const tmdbConfigured = data?.tmdbConfigured;
  const totalItems = libraries.reduce(
    (sum, library) => sum + (library.itemCount ?? 0),
    0,
  );
  const showEmptyState =
    loaded && !isScanning && (!libraries.length || !recentlyAdded.length);

  useEffect(() => {
    if (!featured) return;
    prefetchPosterNavigation(featured);
  }, [featured]);

  useEffect(() => {
    if (!loaded) return;
    preloadPosterList(recentlyAdded, 10);
    if (continueWatching.length > 0) {
      preloadPosterList(
        continueWatching.map((item) => ({
          id: item.mediaId,
          posterPath: item.posterPath,
          backdropPath: item.posterPath,
        })),
        8,
      );
    }
  }, [loaded, recentlyAdded, continueWatching]);

  useEffect(() => {
    setFeaturedImageReady(false);
  }, [featuredImage]);

  const handleFeaturedImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.complete && img.naturalWidth > 0) {
      setFeaturedImageReady(true);
    }
  };

  return (
    <div className="pb-16">
      <section className="home-hero relative mb-14 overflow-hidden border-b border-border/70 px-4 pb-14 pt-10 sm:px-6 sm:pb-16 sm:pt-12">
        <HomeHeroWatermark />

        <div className="relative z-10 mx-auto max-w-7xl">
          <div className="grid items-end gap-10 lg:grid-cols-12 lg:gap-8 xl:gap-10">
            <div className="lg:col-span-5 xl:col-span-5">
              {isScanning && (
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-background/60 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider text-primary backdrop-blur-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Scan in progress
                </div>
              )}

              <HomeHeroStatic />

              <div className={cn("mt-8", !loaded && "min-h-12")}>
                {!loaded ? (
                  <Skeleton className="h-12 w-60 max-w-full rounded-md" />
                ) : continueTarget && continueHref ? (
                  <Link
                    href={continueHref}
                    className="home-hero-resume group inline-flex min-h-12 items-center gap-3 rounded-md px-4 py-3 text-sm font-semibold text-foreground sm:px-5"
                  >
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-primary/70">
                      Resume
                    </span>
                    <span className="h-4 w-px bg-primary/25" aria-hidden />
                    <Play className="h-4 w-4 fill-primary text-primary transition-transform group-hover:scale-110" />
                    <span className="truncate">{continueTarget.title}</span>
                  </Link>
                ) : null}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <TelemCell
                  code="LIB"
                  label="Libraries"
                  value={loaded ? libraries.length : null}
                  fill={loaded ? Math.min(libraries.length / 8, 1) : 0}
                />
                <TelemCell
                  code="TTL"
                  label="Titles"
                  value={loaded ? totalItems : null}
                  fill={loaded ? Math.min(totalItems / 400, 1) : 0}
                />
                <TelemCell
                  code="META"
                  label="Metadata"
                  value={
                    loaded && tmdbConfigured !== undefined
                      ? tmdbConfigured
                        ? "On"
                        : "Off"
                      : null
                  }
                  fill={
                    loaded && tmdbConfigured !== undefined ? (tmdbConfigured ? 1 : 0.18) : 0
                  }
                />
              </div>

            {activeScan && (
              <ScanProgressBanner scan={activeScan} className="mt-6 max-w-2xl" />
            )}

            {loaded && tmdbConfigured === false && (
              <div className="mt-4 max-w-2xl rounded-md border border-amber-400/35 bg-amber-400/10 px-4 py-3">
                <p className="text-sm text-amber-100">
                  TMDB is off. Add a key in{" "}
                  <Link href="/settings" className="text-accent underline">
                    Settings
                  </Link>{" "}
                  to pull posters and metadata.
                </p>
              </div>
            )}
            </div>

            <div className="home-hero-monitor relative lg:col-span-7 xl:col-span-7">
              <div
                className={cn(
                  "home-hero-monitor-shell group relative min-h-[360px] overflow-hidden rounded-lg border border-primary/20 bg-card sm:min-h-[400px]",
                  loaded && featured && "cursor-pointer transition-colors hover:border-primary/40",
                )}
              >
                {loaded && featured ? (
                  <Link
                    href={routes.media(featured.id)}
                    className="absolute inset-0 z-30 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`Open ${featured.title}`}
                  />
                ) : null}
                {(!loaded || (featuredImage && !featuredImageReady)) && (
                  <Skeleton className="absolute inset-0 rounded-none" />
                )}
                {loaded && featuredImage ? (
                  <MediaImage
                    src={featuredImage}
                    alt={featured?.title ?? ""}
                    fill
                    priority
                    sizes="100vw"
                    onLoad={handleFeaturedImageLoad}
                    ref={(node: HTMLImageElement | null) => {
                      if (node?.complete && node.naturalWidth > 0) {
                        setFeaturedImageReady(true);
                      }
                    }}
                    className={cn(
                      "object-cover transition-opacity duration-500",
                      featuredImageReady ? "opacity-100" : "opacity-0",
                    )}
                  />
                ) : loaded ? (
                  <div className="signal-grid absolute inset-0" />
                ) : null}

                <div className="home-hero-scanlines pointer-events-none absolute inset-0 z-10 opacity-70" />
                <div className="absolute inset-0 z-10 bg-gradient-to-t from-background via-background/72 to-background/15" />
                <div className="absolute inset-0 z-10 bg-gradient-to-r from-background/45 via-transparent to-transparent" />
                <HomeHeroMonitorFrame />

                <div className="absolute bottom-0 left-0 right-0 z-20 p-5 sm:p-6">
                  <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.24em] text-primary">
                    Recently added
                  </p>
                  {!loaded ? (
                    <div className="space-y-3">
                      <Skeleton className="h-8 w-3/4 max-w-xs" />
                      <Skeleton className="h-9 w-24" />
                    </div>
                  ) : featured ? (
                    <>
                      <h2 className="line-clamp-2 text-2xl font-bold sm:text-3xl">
                        {featured.title}
                      </h2>
                      <div className="mt-4 flex items-center gap-3">
                        <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background/80 px-3 text-sm font-medium transition-colors group-hover:border-primary/50 group-hover:text-primary">
                          Open
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                        <span className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                          {featured.type === "movie" ? "Film" : "Series"}
                          {featured.year ? ` / ${featured.year}` : ""}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <Clapperboard className="mb-4 h-12 w-12 text-primary" />
                        <h2 className="text-2xl font-bold">Library waiting</h2>
                      </div>
                      <Button size="sm" asChild>
                        <Link href="/settings">
                          Add source
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {(continueWatching.length > 0 || !loaded) && (
        <section className="mb-12 min-h-[13.5rem] sm:min-h-[15rem]">
          <HomeSectionHeading
            title="Continue Watching"
            accent="accent"
            href={continueWatching.length > 0 ? routes.continueWatching() : undefined}
          />
          {!loaded ? (
            <PosterRowSkeleton wide />
          ) : (
            <ContinueWatchingRow items={continueWatching} hideHeader />
          )}
        </section>
      )}

      {favorites.length > 0 && (
        <section className="mb-12 min-h-[13.5rem] sm:min-h-[15rem]">
          <HomeSectionHeading title="Favorites" href={routes.favorites()} />
          {!loaded ? (
            <PosterRowSkeleton />
          ) : (
            <MediaRow title="Favorites" items={favorites} hideHeader />
          )}
        </section>
      )}

      <section className="mb-12 min-h-[13.5rem] sm:min-h-[15rem]">
        <HomeSectionHeading
          title="Recently Added"
          href={recentlyAdded.length > 0 ? routes.recentlyAdded() : undefined}
        />
        {!loaded ? (
          <PosterRowSkeleton />
        ) : (
          <MediaRow title="Recently Added" items={recentlyAdded} hideHeader />
        )}
      </section>

      <section className="mx-auto mb-10 min-h-[5.5rem] max-w-7xl px-4 sm:px-6">
        <HomeSectionHeading
          title="Library Decks"
          href={
            decks.length > 0 || libraries.length > 0 ? routes.browse() : undefined
          }
        />
        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-[5.5rem] rounded-md" />
            ))}
          </div>
        ) : decks.length > 0 || libraries.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href={routes.favorites()}
              className="group relative overflow-hidden rounded-md border border-border/80 bg-card/85 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card"
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-primary/0 transition-colors group-hover:bg-primary" />
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                  <Heart className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold group-hover:text-primary">
                    Favorites
                  </h3>
                  <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                    Saved titles / {favorites.length} favorited
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </div>
            </Link>

            {decks.map((deck) => (
              <Link
                key={`deck-${deck.id}`}
                href={routes.deck(deck.id)}
                className="group relative overflow-hidden rounded-md border border-border/80 bg-card/85 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card"
              >
                <div className="absolute inset-y-0 left-0 w-1 bg-primary/0 transition-colors group-hover:bg-primary" />
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold group-hover:text-primary">
                      {deck.name}
                    </h3>
                    <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                      Custom / {deck.itemCount ?? 0} titles
                    </p>
                    {deck.libraryNames.length > 0 && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {deck.libraryNames.join(", ")}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </div>
              </Link>
            ))}

            {libraries.map((lib) => (
              <Link
                key={`library-${lib.id}`}
                href={routes.library(lib.id)}
                className="group relative overflow-hidden rounded-md border border-border/80 bg-card/85 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card"
              >
                <div className="absolute inset-y-0 left-0 w-1 bg-primary/0 transition-colors group-hover:bg-primary" />
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                    <LibraryIcon type={lib.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold group-hover:text-primary">
                      {lib.name}
                    </h3>
                    <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                      {lib.type === "movies" ? "Full library" : "Full series"} /{" "}
                      {lib.itemCount ?? 0} titles
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {showEmptyState && (
        <div className="mx-auto max-w-lg border-y border-border/70 px-6 py-16 text-center">
          <HardDrive className="mx-auto mb-4 h-14 w-14 text-primary" />
          <h2 className="mb-2 text-2xl font-semibold">No media yet</h2>
          <p className="mb-6 text-muted-foreground">
            Add movie and TV folders in Settings, then scan them into MEDIA!.
          </p>
          <Button asChild>
            <Link href="/settings">
              Open settings
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function TelemCell({
  code,
  label,
  value,
  fill,
}: {
  code: string;
  label: string;
  value: string | number | null;
  fill: number;
}) {
  return (
    <div className="home-hero-telem-cell min-w-[6.75rem] flex-1 rounded-md px-3.5 py-3 sm:min-w-[7.25rem] sm:px-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.24em] text-primary/65">
          {code}
        </span>
        <span className="font-mono text-[0.52rem] uppercase tracking-widest text-muted-foreground/70">
          {label}
        </span>
      </div>
      {value === null ? (
        <Skeleton className="mt-2 h-8 w-14" />
      ) : (
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      )}
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-primary/10">
        <div
          className="home-hero-telem-bar h-full rounded-full bg-gradient-to-r from-primary to-accent"
          style={{ width: `${Math.round(Math.max(0, Math.min(fill, 1)) * 100)}%` }}
        />
      </div>
    </div>
  );
}
