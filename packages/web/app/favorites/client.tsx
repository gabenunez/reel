"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFavoritesRouteFilter } from "@/lib/use-route-params";
import { api, type MediaItem } from "@/lib/api";
import type { PaginatedPageData } from "@/lib/server-api";
import { routes } from "@/lib/routes";
import { PosterCard } from "@/components/poster-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTvMode } from "@/lib/tv-mode";
import { TvFavoritesView } from "@/components/tv/views/favorites-view";

type FavoriteFilter = "all" | "movie" | "tv";

export function FavoritesClient({
  initialPage = null,
}: {
  initialPage?: PaginatedPageData<MediaItem> | null;
}) {
  const isTvMode = useTvMode();
  if (isTvMode) return <TvFavoritesView />;
  return <FavoritesDesktopClient initialPage={initialPage} />;
}

function FavoritesDesktopClient({
  initialPage = null,
}: {
  initialPage?: PaginatedPageData<MediaItem> | null;
}) {
  const filterParam = useFavoritesRouteFilter();
  const filter: FavoriteFilter = filterParam;

  const [items, setItems] = useState(initialPage?.items ?? []);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialPage?.totalPages ?? 1);
  const [loading, setLoading] = useState(!initialPage);

  useDocumentTitle("Favorites");

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    if (page === 1 && initialPage) {
      setItems(initialPage.items);
      setTotalPages(initialPage.totalPages);
      setLoading(false);
      return;
    }

    setLoading(true);
    api
      .getFavorites(page, filter === "all" ? undefined : filter)
      .then((data) => {
        setItems(data.items);
        setTotalPages(data.totalPages);
      })
      .catch((err) => console.warn("Failed to load favorites", err))
      .finally(() => setLoading(false));
  }, [page, filter, initialPage]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <p className="mb-1 flex items-center gap-2 font-mono text-[0.68rem] uppercase text-primary">
              <Heart className="h-3.5 w-3.5" />
              Quick access
            </p>
            <h1 className="text-3xl font-bold">Favorites</h1>
          </div>
        </div>
        {!loading && (
          <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
            {items.length} shown / page {page}
          </p>
        )}
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {(
          [
            { id: "all", label: "All" },
            { id: "movie", label: "Movies" },
            { id: "tv", label: "TV Shows" },
          ] as const
        ).map((option) => (
          <Button
            key={option.id}
            variant={filter === option.id ? "default" : "outline"}
            size="sm"
            asChild
          >
            <Link href={routes.favorites(option.id === "all" ? undefined : option.id)}>
              {option.label}
            </Link>
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border-y border-border/70 py-16 text-center">
          <Heart className="mx-auto mb-4 h-12 w-12 text-primary" />
          <h2 className="mb-2 text-xl font-semibold">No favorites yet</h2>
          <p className="mb-6 text-muted-foreground">
            Open a movie or TV show and tap Favorite to save it here.
          </p>
          <Button asChild>
            <Link href="/">Browse home</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((item) => (
              <PosterCard key={item.id} item={item} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
