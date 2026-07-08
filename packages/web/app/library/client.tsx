"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLibraryRouteContext } from "@/lib/use-route-params";
import { useIsClient } from "@/lib/use-browser-pathname";
import { api, type MediaItem } from "@/lib/api";
import type { PaginatedPageData } from "@/lib/server-api";
import { PosterCard } from "@/components/poster-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, LibraryBig } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTvMode } from "@/lib/tv-mode";
import { TvLibraryView } from "@/components/tv/views/library-view";

type LibraryInitialList = {
  kind: "library" | "deck";
  id: number;
  page: PaginatedPageData<MediaItem> | null;
  title?: string;
  subtitle?: string;
};

export function LibraryClient({
  initialList = null,
}: {
  initialList?: LibraryInitialList | null;
}) {
  const isTvMode = useTvMode();
  if (isTvMode) return <TvLibraryView />;
  return <LibraryDesktopClient initialList={initialList} />;
}

function LibraryDesktopClient({
  initialList = null,
}: {
  initialList?: LibraryInitialList | null;
}) {
  const isClient = useIsClient();
  const { libraryId, deckId } = useLibraryRouteContext();
  const seed =
    initialList &&
    ((initialList.kind === "library" && initialList.id === libraryId) ||
      (initialList.kind === "deck" && initialList.id === deckId))
      ? initialList
      : null;

  const [items, setItems] = useState(seed?.page?.items ?? []);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(seed?.page?.totalPages ?? 1);
  const [loading, setLoading] = useState(!seed?.page);
  const [title, setTitle] = useState(seed?.title ?? "Browse Titles");
  const [subtitle, setSubtitle] = useState(seed?.subtitle ?? "Library deck");

  const isDeck = !Number.isNaN(deckId) && deckId > 0;
  const isLibrary = !Number.isNaN(libraryId) && libraryId > 0;

  useDocumentTitle(isDeck || isLibrary ? title : null);

  useEffect(() => {
    setPage(1);
  }, [libraryId, deckId]);

  useEffect(() => {
    if (!isDeck && !isLibrary) return;

    if (page === 1 && seed?.page) {
      setItems(seed.page.items);
      setTotalPages(seed.page.totalPages);
      if (seed.title) setTitle(seed.title);
      if (seed.subtitle) setSubtitle(seed.subtitle);
      setLoading(false);
      return;
    }

    setLoading(true);

    if (isDeck) {
      api
        .getDeck(deckId)
        .then((deck) => {
          setTitle(deck.name);
          setSubtitle(
            `${deck.paths.length} folder${deck.paths.length === 1 ? "" : "s"} / ${deck.libraryNames.join(", ") || "Custom deck"}`,
          );
        })
        .catch(console.warn);

      api
        .getDeckItems(deckId, page)
        .then((data) => {
          setItems(data.items);
          setTotalPages(data.totalPages);
        })
        .catch((err) => console.warn("Failed to load deck items", err))
        .finally(() => setLoading(false));
      return;
    }

    setTitle("Browse Titles");
    setSubtitle("Full library");
    api
      .getLibraryItems(libraryId, page)
      .then((data) => {
        setItems(data.items);
        setTotalPages(data.totalPages);
      })
      .catch((err) => console.warn("Failed to load library items", err))
      .finally(() => setLoading(false));
  }, [libraryId, deckId, page, isDeck, isLibrary, seed]);

  if (!isDeck && !isLibrary) {
    if (!isClient) {
      return (
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <Skeleton className="mb-8 h-10 w-48" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] rounded-md" />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6">
        <p className="mb-4 text-muted-foreground">Invalid library or deck</p>
        <Button asChild>
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

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
              <LibraryBig className="h-3.5 w-3.5" />
              {subtitle}
            </p>
            <h1 className="text-3xl font-bold">{title}</h1>
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
          <LibraryBig className="mx-auto mb-4 h-12 w-12 text-primary" />
          <p className="text-muted-foreground">
            {isDeck ? "No titles match this deck yet." : "No items in this library yet."}
          </p>
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
