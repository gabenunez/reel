"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { TMDB_IMAGE_BASE } from "@media-app/shared";
import {
  api,
  type MetadataSearchCandidate,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TvFocusButton } from "@/components/tv/tv-focus-link";
import { TvWatchSideSheet } from "@/components/tv/tv-watch-settings-menu";
import { MediaImage } from "@/components/media-image";
import { cn } from "@/lib/utils";
import { focusFirstWatchMenuItem, focusTvItem } from "@/lib/tv-focus";

interface FixMatchDialogProps {
  open: boolean;
  onClose: () => void;
  mediaId: number;
  mediaType: "movie" | "tv";
  initialTitle: string;
  initialYear?: number | null;
  currentImdbId?: string | null;
  currentTmdbId?: number | null;
  onMatched: () => void;
  tv?: boolean;
}

function candidatePosterUrl(posterPath: string | null): string | null {
  if (!posterPath) return null;
  if (posterPath.startsWith("/api/") || posterPath.startsWith("http")) {
    return posterPath;
  }
  return `${TMDB_IMAGE_BASE}/w185${posterPath}`;
}

export function FixMatchDialog({
  open,
  onClose,
  mediaId,
  mediaType,
  initialTitle,
  initialYear,
  currentImdbId,
  currentTmdbId,
  onMatched,
  tv = false,
}: FixMatchDialogProps) {
  const [query, setQuery] = useState(initialTitle);
  const [year, setYear] = useState(
    initialYear != null ? String(initialYear) : "",
  );
  const [results, setResults] = useState<MetadataSearchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const firstResultRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialTitle);
    setYear(initialYear != null ? String(initialYear) : "");
    setResults([]);
    setError(null);
    setApplyingId(null);
  }, [open, initialTitle, initialYear]);

  useEffect(() => {
    if (!open || !initialTitle.trim()) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.searchMetadata({
          query: initialTitle.trim(),
          year: initialYear ?? undefined,
          type: mediaType,
        });
        setResults(data.results);
        if (!data.results.length && initialYear != null) {
          // Wrong folder years (e.g. Beaches 1998) often miss — retry without year.
          const fallback = await api.searchMetadata({
            query: initialTitle.trim(),
            type: mediaType,
          });
          setResults(fallback.results);
          if (!fallback.results.length) {
            setError(
              "No listings found. Try another year, or paste an IMDb link (tt…).",
            );
          }
        } else if (!data.results.length) {
          setError(
            "No listings found. Try another year, or paste an IMDb link (tt…).",
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, initialTitle, initialYear, mediaType]);

  useEffect(() => {
    if (!open || tv) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open, tv]);

  useEffect(() => {
    if (!open || !tv) return;
    requestAnimationFrame(() => {
      if (results.length > 0 && firstResultRef.current) {
        focusTvItem(firstResultRef.current);
        return;
      }
      if (!focusFirstWatchMenuItem()) {
        (searchButtonRef.current ?? closeButtonRef.current)?.focus();
      }
    });
  }, [open, tv, results.length, loading]);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Enter a title or IMDb link");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const yearNum = year.trim() ? parseInt(year.trim(), 10) : undefined;
      const data = await api.searchMetadata({
        query: trimmed,
        year: yearNum && Number.isFinite(yearNum) ? yearNum : undefined,
        type: mediaType,
      });
      setResults(data.results);
      if (!data.results.length) {
        setError(
          "No listings found. Try another year, or paste an IMDb link (tt…).",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const applyMatch = async (candidate: MetadataSearchCandidate) => {
    setApplyingId(candidate.tmdbId);
    setError(null);
    try {
      await api.applyMediaMatch(mediaId, candidate.tmdbId);
      onMatched();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply match");
    } finally {
      setApplyingId(null);
    }
  };

  if (!open) return null;

  const currentLabel = [
    currentTmdbId ? `TMDB ${currentTmdbId}` : null,
    currentImdbId,
  ]
    .filter(Boolean)
    .join(" · ");

  const form = (
    <>
      <p className="text-sm text-muted-foreground">
        Search by title, or paste an IMDb link / id to pin the correct listing.
        {currentLabel ? (
          <>
            {" "}
            Current: <span className="font-mono text-foreground/80">{currentLabel}</span>
          </>
        ) : (
          " This title isn’t matched yet."
        )}
      </p>

      <div className={cn("mt-4 grid gap-3", tv ? "grid-cols-1" : "sm:grid-cols-[1fr_6.5rem_auto]")}
      >
        <Input
          ref={searchInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
          placeholder="Beaches, or imdb.com/title/tt0094715"
          aria-label="Title or IMDb link"
          className={tv ? "h-12 text-base" : undefined}
        />
        <Input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
          placeholder="Year"
          inputMode="numeric"
          aria-label="Year"
          className={tv ? "h-12 text-base" : undefined}
        />
        {tv ? (
          <TvFocusButton
            ref={searchButtonRef}
            onClick={() => void runSearch()}
            disabled={loading}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </TvFocusButton>
        ) : (
          <Button onClick={() => void runSearch()} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {loading && results.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching…
          </div>
        ) : (
          <ul className="flex flex-col gap-2 pb-2">
            {results.map((result, index) => {
              const poster = candidatePosterUrl(result.posterPath);
              const selected =
                result.tmdbId === currentTmdbId ||
                (result.imdbId != null &&
                  result.imdbId.toLowerCase() === currentImdbId?.toLowerCase());
              const applying = applyingId === result.tmdbId;
              const body = (
                <>
                  <div className="h-[4.5rem] w-[3rem] shrink-0 overflow-hidden rounded border border-border/80 bg-muted">
                    {poster ? (
                      <MediaImage
                        src={poster}
                        alt=""
                        width={48}
                        height={72}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="signal-grid h-full w-full" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate font-medium text-foreground">
                      {result.title}
                      {result.year != null ? (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          ({result.year})
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {result.imdbId ?? `TMDB ${result.tmdbId}`}
                    </p>
                    {result.overview && (
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground/90">
                        {result.overview}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-muted-foreground">
                    {applying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : selected ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : null}
                  </div>
                </>
              );

              if (tv) {
                return (
                  <li key={result.tmdbId}>
                    <TvFocusButton
                      ref={index === 0 ? firstResultRef : undefined}
                      disabled={applyingId != null}
                      onClick={() => void applyMatch(result)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg border border-transparent bg-white/5 px-3 py-3",
                        selected && "border-primary/50 bg-primary/10",
                      )}
                    >
                      {body}
                    </TvFocusButton>
                  </li>
                );
              }

              return (
                <li key={result.tmdbId}>
                  <button
                    type="button"
                    disabled={applyingId != null}
                    onClick={() => void applyMatch(result)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md border border-border/70 bg-background/40 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-background/70",
                      selected && "border-primary/50 bg-primary/10",
                      applyingId != null && "opacity-70",
                    )}
                  >
                    {body}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );

  if (tv) {
    return (
      <TvWatchSideSheet>
        <aside data-tv-watch-menu="" className="flex h-full min-h-0 flex-col">
          <div
            data-tv-row=""
            data-tv-watch-menu-header=""
            className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"
          >
            <div>
              <h3 className="text-lg font-semibold">Fix match</h3>
              <p className="text-sm text-muted-foreground">Pick the right listing</p>
            </div>
            <TvFocusButton
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg border border-border px-3 py-2"
            >
              <X className="h-4 w-4" />
            </TvFocusButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">{form}</div>
        </aside>
      </TvWatchSideSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-label="Fix match"
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">Fix match</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Correct the IMDb / TMDB listing for this file
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-5 py-4">{form}</div>
      </div>
    </div>
  );
}
