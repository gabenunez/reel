"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvPageHeader, TvSectionLabel } from "@/components/tv/tv-page-header";
import { TvGrid } from "@/components/tv/tv-row";
import { TvPoster } from "@/components/tv/tv-poster";
import { useDocumentTitle } from "@/lib/use-document-title";
import { focusFirstContentItem } from "@/lib/tv-focus";

export function TvSearchView() {
  useDocumentTitle("Search");
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      api
        .search(trimmed)
        .then((data) => {
          setResults(data.results);
          setSearched(true);
        })
        .catch(console.warn)
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!searched || loading || results.length === 0) return;
    focusFirstContentItem();
  }, [searched, loading, results]);

  return (
    <div className="px-6 py-5">
      <TvPageHeader backHref={routes.home()} title="Search" />

      <div data-tv-row="" data-tv-content-row="" className="mb-4 py-0.5">
        <div className="relative max-w-2xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies and TV shows..."
            className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
      </div>

      {loading && (
        <div className="flex min-h-[20vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <p className="py-12 text-center text-muted-foreground">No results found.</p>
      )}

      {!loading && results.length > 0 && (
        <>
          <TvSectionLabel>{results.length} results</TvSectionLabel>
          <TvGrid>
            {results.map((item) => (
              <TvPoster key={item.id} item={item} linkClassName="w-full" className="min-w-0" />
            ))}
          </TvGrid>
        </>
      )}

      {!loading && !searched && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Type at least 2 characters to search.
        </div>
      )}
    </div>
  );
}
