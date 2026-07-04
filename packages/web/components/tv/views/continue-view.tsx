"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, type ContinueWatchingItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvPageHeader, TvPagination, TvSectionLabel } from "@/components/tv/tv-page-header";
import { TvGrid } from "@/components/tv/tv-row";
import { TvPoster } from "@/components/tv/tv-poster";
import { useDocumentTitle } from "@/lib/use-document-title";
import { focusFirstContentItem } from "@/lib/tv-focus";

export function TvContinueView() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);

  useDocumentTitle("Continue Watching");

  useEffect(() => {
    setLoading(true);
    api
      .getContinueWatching(page)
      .then((data) => {
        setItems(data.items);
        setTotalPages(data.totalPages);
        setTotalItems(data.total ?? data.items.length);
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    if (loading) return;
    focusFirstContentItem();
  }, [loading, page]);

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
      <TvPageHeader
        backHref={routes.home()}
        title="Continue Watching"
        trailing={trailing}
      />

      {items.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">Nothing in progress yet.</p>
      ) : (
        <>
          <TvSectionLabel>
            {totalItems > 0 ? `${totalItems} in progress` : `${items.length} in progress`}
          </TvSectionLabel>
          <TvGrid className="mb-4">
            {items.map((item) => (
              <TvPoster
                key={item.id}
                item={{
                  id: item.mediaId,
                  libraryId: 0,
                  title: item.title,
                  type: item.itemType === "movie" ? "movie" : "tv",
                  posterPath: item.posterPath,
                }}
                href={
                  item.itemType === "movie"
                    ? routes.watch("movie", item.itemId, item.mediaId)
                    : routes.watch("episode", item.itemId, item.mediaId)
                }
                progress={item.percent}
                subtitle={item.subtitle}
                linkClassName="w-full"
                className="min-w-0"
              />
            ))}
          </TvGrid>
          <TvPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
