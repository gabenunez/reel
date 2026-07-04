"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LibraryBig, Loader2 } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvFocusLink } from "@/components/tv/tv-focus-link";
import { TvPageHeader, TvPagination, TvSectionLabel } from "@/components/tv/tv-page-header";
import { TvGrid } from "@/components/tv/tv-row";
import { TvPoster } from "@/components/tv/tv-poster";
import { useDocumentTitle } from "@/lib/use-document-title";
import { focusFirstContentItem } from "@/lib/tv-focus";

export function TvLibraryView() {
  const searchParams = useSearchParams();
  const libraryId = parseInt(searchParams.get("id") ?? "", 10);
  const deckId = parseInt(searchParams.get("deck") ?? "", 10);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Browse");

  const isDeck = !Number.isNaN(deckId) && deckId > 0;
  const isLibrary = !Number.isNaN(libraryId) && libraryId > 0;

  useDocumentTitle(isDeck || isLibrary ? title : null);

  useEffect(() => {
    setPage(1);
  }, [libraryId, deckId]);

  useEffect(() => {
    if (!isDeck && !isLibrary) return;

    setLoading(true);

    if (isDeck) {
      api
        .getDeck(deckId)
        .then((deck) => setTitle(deck.name))
        .catch(console.warn);

      api
        .getDeckItems(deckId, page)
        .then((data) => {
          setItems(data.items);
          setTotalPages(data.totalPages);
          setTotalItems(data.total ?? data.items.length);
        })
        .catch(console.warn)
        .finally(() => setLoading(false));
      return;
    }

    setTitle("Library");
    api
      .getLibraryItems(libraryId, page)
      .then((data) => {
        setItems(data.items);
        setTotalPages(data.totalPages);
        setTotalItems(data.total ?? data.items.length);
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [libraryId, deckId, page, isDeck, isLibrary]);

  useEffect(() => {
    if (loading) return;
    focusFirstContentItem();
  }, [loading, page]);

  if (!isDeck && !isLibrary) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="mb-4 text-muted-foreground">Invalid library or deck</p>
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

  const backHref = routes.home();
  const eyebrow = (
    <span className="inline-flex items-center gap-1.5">
      <LibraryBig className="h-3 w-3" />
      {isDeck ? "Deck" : "Library"}
    </span>
  );
  const trailing =
    !loading && totalPages > 1 ? `Page ${page} of ${totalPages}` : undefined;

  return (
    <div className="px-6 py-5">
      <TvPageHeader
        backHref={backHref}
        title={title}
        eyebrow={eyebrow}
        trailing={trailing}
      />

      {loading ? (
        <div className="flex min-h-[35vh] items-center justify-center">
          <Loader2 className="h-9 w-9 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">No titles here yet.</div>
      ) : (
        <>
          <TvSectionLabel>
            {totalItems > 0 ? `${totalItems} titles` : "Titles"}
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
