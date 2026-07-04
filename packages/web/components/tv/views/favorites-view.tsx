"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvFocusLink } from "@/components/tv/tv-focus-link";
import { TvPageHeader, TvPagination, TvSectionLabel } from "@/components/tv/tv-page-header";
import { TvGrid, tvScrollRowClassName } from "@/components/tv/tv-row";
import { TvPoster } from "@/components/tv/tv-poster";
import { useDocumentTitle } from "@/lib/use-document-title";
import { focusFirstContentItem } from "@/lib/tv-focus";
import { cn } from "@/lib/utils";

type FavoriteFilter = "all" | "movie" | "tv";

export function TvFavoritesView() {
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("type");
  const filter: FavoriteFilter =
    filterParam === "movie" || filterParam === "tv" ? filterParam : "all";

  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);

  useDocumentTitle("Favorites");

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    api
      .getFavorites(page, filter === "all" ? undefined : filter)
      .then((data) => {
        setItems(data.items);
        setTotalPages(data.totalPages);
        setTotalItems(data.total ?? data.items.length);
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [filter, page]);

  useEffect(() => {
    if (loading) return;
    focusFirstContentItem();
  }, [loading, filter, page]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
      </div>
    );
  }

  const trailing =
    totalPages > 1 ? `Page ${page} of ${totalPages}` : undefined;

  return (
    <div className="px-6 py-5">
      <TvPageHeader backHref={routes.home()} title="Favorites" trailing={trailing} />

      <div
        data-tv-row=""
        data-tv-content-row=""
        data-tv-scroll-row=""
        className={cn(tvScrollRowClassName, "mb-4 gap-2 px-0 py-1")}
      >
        {(
          [
            { id: "all", label: "All" },
            { id: "movie", label: "Movies" },
            { id: "tv", label: "TV Shows" },
          ] as const
        ).map((option) => (
          <TvFocusLink
            key={option.id}
            href={routes.favorites(option.id === "all" ? undefined : option.id)}
            variant="card"
            className={cn(
              "shrink-0 snap-center px-4 py-2 text-sm font-semibold transition-[background-color,transform] duration-150",
              filter === option.id
                ? "bg-primary text-primary-foreground scale-105"
                : "bg-muted/60 text-foreground",
            )}
          >
            {option.label}
          </TvFocusLink>
        ))}
      </div>

      {items.length === 0 ? (
        <div
          data-tv-row=""
          data-tv-content-row=""
          className="rounded-lg bg-muted/20 px-6 py-12 text-center"
        >
          <p className="mb-4 text-muted-foreground">No favorites yet.</p>
          <TvFocusLink
            href={routes.home()}
            variant="card"
            className="inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Back to home
          </TvFocusLink>
        </div>
      ) : (
        <>
          <TvSectionLabel>
            {totalItems > 0 ? `${totalItems} saved` : `${items.length} saved`}
          </TvSectionLabel>
          <TvGrid className="mb-4">
            {items.map((item) => (
              <TvPoster key={item.id} item={item} linkClassName="w-full" className="min-w-0" />
            ))}
          </TvGrid>
          <TvPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
