"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Film, Loader2, Search, Tv, X } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { MediaImage } from "@/components/media-image";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { useMediaSearch } from "@/lib/use-media-search";

interface SearchPopoverProps {
  variant?: "bar" | "icon";
  className?: string;
}

export function SearchPopover({ variant = "bar", className }: SearchPopoverProps) {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { results, loading, searched } = useMediaSearch(query, {
    minLength: 1,
    debounceMs: 250,
  });

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }, []);

  const openSearch = useCallback(() => {
    setOpen(true);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (variant !== "bar") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [variant, openSearch]);

  useEffect(() => {
    if (!open || variant !== "icon") return;
    inputRef.current?.focus();
  }, [open, variant]);

  useEffect(() => {
    if (!open) return;

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

  const resultsPanel = (
    <div
      className={cn(
        "absolute z-50 overflow-hidden rounded-lg border border-border bg-card shadow-2xl",
        variant === "bar"
          ? "left-0 right-0 top-[calc(100%+0.5rem)]"
          : "right-0 top-[calc(100%+0.5rem)] w-[min(100vw-2rem,28rem)]",
      )}
    >
      {variant === "icon" && (
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
      )}

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
        ) : searched && query.trim() ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No results for &ldquo;{query.trim()}&rdquo;
          </p>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Start typing to search your library.
          </p>
        )}
      </div>
    </div>
  );

  if (variant === "bar") {
    return (
      <div ref={containerRef} className={cn("relative", className)}>
        <div
          className={cn(
            "relative flex h-10 w-full items-center rounded-lg border px-3 transition-all",
            open
              ? "border-primary/40 bg-background/80 ring-1 ring-primary/20"
              : "border-border/70 bg-background/35 hover:border-primary/25 hover:bg-background/55",
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-primary/80" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Search your library..."
            aria-expanded={open}
            aria-haspopup="listbox"
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden shrink-0 rounded border border-border/80 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide text-muted-foreground lg:inline">
              ⌘K
            </kbd>
          )}
        </div>

        {open && resultsPanel}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          open && "bg-primary/10 text-primary",
        )}
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next) {
              requestAnimationFrame(() => inputRef.current?.focus());
            }
            return next;
          });
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </button>

      {open && resultsPanel}
    </div>
  );
}

function SearchResultPoster({ item }: { item: MediaItem }) {
  const imageUrl = api.imageUrl(item.posterPath);

  return (
    <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded border border-white/10 bg-muted">
      {imageUrl ? (
        <MediaImage
          src={imageUrl}
          alt=""
          width={40}
          height={56}
          sizes="40px"
          className="h-full w-full object-cover"
        />
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
