"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Film, Loader2, Search, Tv, X } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SearchPopover() {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
  }, []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!open) return;

    inputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, close]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      api
        .search(query)
        .then((data) => setResults(data.results))
        .catch((err) => console.warn("Failed to search media", err))
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "gap-2 text-muted-foreground hover:bg-muted hover:text-foreground",
          open && "bg-primary/[0.12] text-primary",
        )}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
      </Button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(100vw-2rem,28rem)] overflow-hidden rounded-md border border-border bg-card shadow-2xl">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search movies and TV shows..."
                className="h-10 w-full rounded-md border border-border bg-background/55 py-2 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {query && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[min(60vh,24rem)] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </div>
            ) : results.length > 0 ? (
              <ul className="p-2">
                {results.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={routes.media(item.id)}
                      onClick={close}
                      className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
                    >
                      <SearchResultPoster item={item} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="mt-0.5 flex items-center gap-2 font-mono text-[0.68rem] uppercase text-muted-foreground">
                          {item.type === "movie" ? (
                            <Film className="h-3 w-3" />
                          ) : (
                            <Tv className="h-3 w-3" />
                          )}
                          {item.year ?? "Unknown year"}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : query.trim() ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No results for &ldquo;{query}&rdquo;
              </p>
            ) : (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Start typing to search your library.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchResultPoster({ item }: { item: MediaItem }) {
  const imageUrl = api.imageUrl(item.posterPath);

  return (
    <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded border border-white/10 bg-muted">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {item.type === "movie" ? (
            <Clapperboard className="h-4 w-4 text-primary" />
          ) : (
            <Tv className="h-4 w-4 text-primary" />
          )}
        </div>
      )}
    </div>
  );
}
