"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Search, X } from "lucide-react";
import { api, type SubtitleSearchResult, type SubtitleTrack } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { TvFocusButton } from "@/components/tv/tv-focus-link";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { focusTvItem } from "@/lib/tv-focus";

interface SubtitleSearchDialogProps {
  open: boolean;
  onClose: () => void;
  fileId: number;
  type: "movie" | "episode";
  opensubtitlesConfigured: boolean;
  onDownloaded: (track: SubtitleTrack) => void;
  tv?: boolean;
}

export function SubtitleSearchDialog({
  open,
  onClose,
  fileId,
  type,
  opensubtitlesConfigured,
  onDownloaded,
  tv = false,
}: SubtitleSearchDialogProps) {
  const [languages, setLanguages] = useState("en");
  const [results, setResults] = useState<SubtitleSearchResult[]>([]);
  const [contextTitle, setContextTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const firstResultRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setResults([]);
      setError(null);
    }
  }, [open]);

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.searchSubtitles(fileId, type, languages);
      setResults(data.results);
      setContextTitle(
        data.context.seasonNumber !== undefined
          ? `${data.context.title} S${data.context.seasonNumber}E${data.context.episodeNumber}`
          : data.context.title,
      );
      if (!data.results.length) {
        setError("No subtitles found. Try another language code (e.g. en, es, fr).");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && opensubtitlesConfigured) {
      runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opensubtitlesConfigured]);

  useEffect(() => {
    if (!open || !tv) return;

    requestAnimationFrame(() => {
      const target =
        results.length > 0
          ? firstResultRef.current
          : opensubtitlesConfigured && !loading
            ? searchButtonRef.current
            : closeButtonRef.current;
      if (target) focusTvItem(target);
    });
  }, [open, tv, opensubtitlesConfigured, results.length, loading]);

  const handleDownload = async (result: SubtitleSearchResult) => {
    setDownloadingId(result.fileId);
    setError(null);
    try {
      const { track } = await api.downloadSubtitle({
        fileId,
        type,
        opensubtitlesFileId: result.fileId,
        language: result.language,
        release: result.release,
      });
      onDownloaded(track);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  if (!open) return null;

  if (tv) {
    return (
      <div
        data-tv-watch-menu=""
        className="fixed inset-0 z-50 flex flex-col bg-background"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-white">Search subtitles</h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {contextTitle || "OpenSubtitles.com"} · matched to your file hash
            </p>
          </div>
          <TvFocusButton
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-white"
          >
            <X className="h-5 w-5" />
          </TvFocusButton>
        </div>

        {!opensubtitlesConfigured ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-base text-muted-foreground">
            <p>Add a free OpenSubtitles API key in Settings to search online subtitles.</p>
            <p>Create one at opensubtitles.com → API consumers → New consumer</p>
          </div>
        ) : (
          <>
            <div
              data-tv-row=""
              data-tv-content-row=""
              data-tv-watch-controls=""
              className="flex flex-wrap items-center gap-2 border-b border-white/10 px-6 py-4"
            >
              <Input
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
                placeholder="Languages (en, es, fr)"
                className="max-w-xs bg-muted/40 text-base text-white"
              />
              <TvFocusButton
                ref={searchButtonRef}
                onClick={runSearch}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search
              </TvFocusButton>
            </div>

            <div
              data-tv-row=""
              data-tv-content-row=""
              data-tv-vertical=""
              className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            >
              {loading ? (
                <p className="px-3 py-12 text-center text-base text-muted-foreground">
                  Searching OpenSubtitles...
                </p>
              ) : results.length ? (
                results.map((result) => (
                  <TvFocusButton
                    key={`${result.id}-${result.fileId}`}
                    ref={result === results[0] ? firstResultRef : undefined}
                    variant="card"
                    disabled={downloadingId === result.fileId}
                    onClick={() => handleDownload(result)}
                    className="mb-1.5 flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-white">
                        {result.language.toUpperCase()}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {result.release}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {result.downloadCount.toLocaleString()} downloads
                        {result.hearingImpaired ? " / HI" : ""}
                        {result.uploader ? ` / ${result.uploader}` : ""}
                      </p>
                    </div>
                    {downloadingId === result.fileId ? (
                      <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-primary" />
                    ) : (
                      <Download className="mt-1 h-5 w-5 shrink-0 text-primary" />
                    )}
                  </TvFocusButton>
                ))
              ) : (
                <p className="px-3 py-12 text-center text-base text-muted-foreground">
                  {error ?? "No results yet"}
                </p>
              )}
            </div>

            {error && results.length > 0 && (
              <p className="border-t border-white/10 px-6 py-3 text-sm text-red-400">{error}</p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">Search subtitles</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {contextTitle || "OpenSubtitles.com"} · matched to your file hash
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!opensubtitlesConfigured ? (
          <div className="space-y-3 px-5 py-8 text-center text-sm text-muted-foreground">
            <p>Add a free OpenSubtitles API key in Settings to search online subtitles.</p>
            <p>
              Create one at{" "}
              <a
                href="https://www.opensubtitles.com/en/consumers"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:text-accent"
              >
                opensubtitles.com → API consumers → New consumer
              </a>
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-border px-5 py-4">
              <Input
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
                placeholder="Languages (en, es, fr)"
                className="max-w-xs"
              />
              <Button onClick={runSearch} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {loading ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Searching OpenSubtitles...
                </p>
              ) : results.length ? (
                results.map((result) => (
                  <div
                    key={`${result.id}-${result.fileId}`}
                    className="flex items-start gap-3 rounded-md px-3 py-3 hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{result.language.toUpperCase()}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {result.release}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {result.downloadCount.toLocaleString()} downloads
                        {result.hearingImpaired ? " / HI" : ""}
                        {result.uploader ? ` / ${result.uploader}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={downloadingId === result.fileId}
                      onClick={() => handleDownload(result)}
                    >
                      {downloadingId === result.fileId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Use
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {error ?? "No results yet"}
                </p>
              )}
            </div>

            {error && results.length > 0 && (
              <p className={cn("border-t border-border px-5 py-3 text-sm text-red-400")}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
