"use client";

import { useState } from "react";
import {
  ArrowUpCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatReleaseDate, previewReleaseNotes } from "@/lib/update-utils";
import { useUpdateStatus } from "@/components/update-status-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UpdateModal() {
  const { status, checking, refresh, modalOpen, closeModal } = useUpdateStatus();
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!modalOpen) return null;

  const releaseDate = formatReleaseDate(status?.publishedAt ?? null);
  const notesPreview = previewReleaseNotes(status?.releaseNotes ?? null);

  const handleApply = async () => {
    if (!status?.latestVersion) return;

    setApplying(true);
    setError(null);
    setMessage(null);

    try {
      const result = await api.applyUpdate(`v${status.latestVersion}`);
      setMessage(result.message);
      await refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed to start");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={closeModal}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">Update available</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {status?.latestVersion
                ? `Reel v${status.latestVersion} is ready to install`
                : "Checking for the latest release..."}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={closeModal}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                Current:{" "}
                <span className="text-primary">v{status?.currentVersion ?? "unknown"}</span>
              </p>
              {status?.latestVersion && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Latest: v{status.latestVersion}
                  {releaseDate ? ` · ${releaseDate}` : ""}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh(true)}
              disabled={checking || applying}
            >
              {checking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          {status?.latestReleaseName && (
            <p className="text-sm font-medium">{status.latestReleaseName}</p>
          )}

          {notesPreview && (
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              {notesPreview}
            </pre>
          )}

          {status?.updateInProgress && (
            <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Update in progress
              </div>
              <p className="mt-1 text-muted-foreground">
                Reel is downloading, building, and restarting. This page may disconnect for a
                minute.
              </p>
            </div>
          )}

          {status?.updateAvailable && !status.updateInProgress && (
            <div className="flex flex-wrap gap-2">
              {status.updateSupported ? (
                <Button onClick={handleApply} disabled={applying}>
                  {applying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="h-4 w-4" />
                  )}
                  Update now
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  In-app updates are not available on this install. Use the shell updater or
                  Settings for manual upgrade steps.
                </p>
              )}
              {status.releaseUrl && (
                <Button variant="outline" asChild>
                  <a href={status.releaseUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Release notes
                  </a>
                </Button>
              )}
            </div>
          )}

          {message && <p className={cn("text-sm text-muted-foreground")}>{message}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
