"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ContinueWatchingItem } from "@/lib/api";
import type { PaginatedPageData } from "@/lib/server-api";
import { routes } from "@/lib/routes";
import { PosterCard } from "@/components/poster-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTvMode } from "@/lib/tv-mode";
import { TvContinueView } from "@/components/tv/views/continue-view";

export function ContinueWatchingClient({
  initialPage = null,
}: {
  initialPage?: PaginatedPageData<ContinueWatchingItem> | null;
}) {
  const isTvMode = useTvMode();
  if (isTvMode) return <TvContinueView />;
  return <ContinueWatchingDesktopClient initialPage={initialPage} />;
}

function ContinueWatchingDesktopClient({
  initialPage = null,
}: {
  initialPage?: PaginatedPageData<ContinueWatchingItem> | null;
}) {
  const [items, setItems] = useState(initialPage?.items ?? []);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialPage?.totalPages ?? 1);
  const [loading, setLoading] = useState(!initialPage);

  useDocumentTitle("Continue Watching");

  useEffect(() => {
    if (page === 1 && initialPage) {
      setItems(initialPage.items);
      setTotalPages(initialPage.totalPages);
      setLoading(false);
      return;
    }

    setLoading(true);
    api
      .getContinueWatching(page)
      .then((data) => {
        setItems(data.items);
        setTotalPages(data.totalPages);
      })
      .catch((err) => console.warn("Failed to load continue watching", err))
      .finally(() => setLoading(false));
  }, [page, initialPage]);

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
            <p className="mb-1 flex items-center gap-2 font-mono text-[0.68rem] uppercase text-accent">
              <Play className="h-3.5 w-3.5 fill-current" />
              Pick up where you left off
            </p>
            <h1 className="text-3xl font-bold">Continue Watching</h1>
          </div>
        </div>
        {!loading && (
          <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
            {items.length} shown / page {page}
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border-y border-border/70 py-16 text-center">
          <Play className="mx-auto mb-4 h-12 w-12 text-accent" />
          <h2 className="mb-2 text-xl font-semibold">Nothing in progress</h2>
          <p className="mb-6 text-muted-foreground">
            Start watching something and it will show up here.
          </p>
          <Button asChild>
            <Link href="/">Browse home</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((item) => (
              <div key={item.id}>
                <PosterCard
                  href={
                    item.itemType === "movie"
                      ? routes.watch("movie", item.itemId, item.mediaId)
                      : routes.watch("episode", item.itemId, item.mediaId)
                  }
                  item={{
                    id: item.mediaId,
                    libraryId: 0,
                    title: item.title,
                    type: item.itemType === "movie" ? "movie" : "tv",
                    posterPath: item.posterPath,
                  }}
                  progress={item.percent}
                />
                {item.subtitle && (
                  <p className="mt-1 truncate px-1 font-mono text-[0.68rem] text-muted-foreground">
                    {item.subtitle}
                  </p>
                )}
              </div>
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
