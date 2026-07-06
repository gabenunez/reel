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
import { formatReleaseDate } from "@/lib/update-utils";
import { useUpdateStatus } from "@/components/update-status-provider";
import { UpdateProgressPanel } from "@/components/update-progress-panel";
import { ReleaseNotes } from "@/components/release-notes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UpdateModal() {
  const { status, checking, refresh, modalOpen, closeModal } = useUpdateStatus();
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setError(
        err instanceof Error && err.message === "Failed to fetch"
          ? "Could not reach the server. If an update is already running, wait for the restart and refresh this page."
          : err instanceof Error
            ? err.message
            : "Update failed to start",
      );
    } finally {
      setApplying(false);
    }
  };

  if (!modalOpen) return null;

  const releaseDate = formatReleaseDate(status?.publishedAt ?? null);
  const showProgress = Boolean(status?.updateInProgress && status.updateProgress);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={showProgress ? undefined : closeModal}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">
              {showProgress ? "Updating MEDIA!" : "Update available"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {showProgress
                ? "Hang tight while MEDIA! upgrades and restarts."
                : status?.latestVersion
                  ? `MEDIA! v${status.latestVersion} is ready to install`
                  : "Checking for the latest release..."}
            </p>
          </div>
          {!showProgress ? (
            <Button variant="ghost" size="icon" onClick={closeModal}>
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {showProgress && status?.updateProgress ? (
            <UpdateProgressPanel progress={status.updateProgress} />
          ) : (
            <>
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

              <ReleaseNotes notes={status?.releaseNotes ?? null} />

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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
