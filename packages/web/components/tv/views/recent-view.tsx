"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvPageHeader, TvPagination, TvSectionLabel } from "@/components/tv/tv-page-header";
import { TvGrid } from "@/components/tv/tv-row";
import { TvPoster } from "@/components/tv/tv-poster";
import { useDocumentTitle } from "@/lib/use-document-title";
import { focusFirstContentItem } from "@/lib/tv-focus";

export function TvRecentView() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);

  useDocumentTitle("Recently Added");

  useEffect(() => {
    setLoading(true);
    api
      .getRecentlyAdded(page)
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
        title="Recently Added"
        trailing={trailing}
      />

      {items.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">Nothing here yet.</p>
      ) : (
        <>
          <TvSectionLabel>
            {totalItems > 0 ? `${totalItems} titles` : `${items.length} titles`}
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
