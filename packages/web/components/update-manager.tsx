"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatReleaseDate, previewReleaseNotes } from "@/lib/update-utils";
import { useUpdateStatus } from "@/components/update-status-provider";
import { UpdateProgressPanel } from "@/components/update-progress-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function UpdateManager() {
  const { status, loading, checking, refresh } = useUpdateStatus();
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
      setError(err instanceof Error ? err.message : "Update failed to start");
    } finally {
      setApplying(false);
    }
  };

  const releaseDate = formatReleaseDate(status?.publishedAt ?? null);
  const notesPreview = previewReleaseNotes(status?.releaseNotes ?? null, 4);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center gap-2">
          <ArrowUpCircle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Updates</h2>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for updates...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  Current version:{" "}
                  <span className="text-primary">v{status?.currentVersion ?? "unknown"}</span>
                </p>
                {status?.latestVersion && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Latest release: v{status.latestVersion}
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
                Check for updates
              </Button>
            </div>

            {status?.updateInProgress && status.updateProgress ? (
              <UpdateProgressPanel progress={status.updateProgress} />
            ) : status?.updateInProgress ? (
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
            ) : null}

            {status?.updateAvailable && !status.updateInProgress && (
              <div className="rounded-md border border-accent/30 bg-accent/10 px-4 py-4">
                <p className="font-medium">
                  Update available: v{status.latestVersion}
                  {status.latestReleaseName ? ` — ${status.latestReleaseName}` : ""}
                </p>
                {notesPreview && (
                  <pre className="mt-3 whitespace-pre-wrap rounded bg-background/60 p-3 text-xs text-muted-foreground">
                    {notesPreview}
                  </pre>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
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
                      In-app updates are not available on this install. Use the shell updater
                      instead.
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
              </div>
            )}

            {status && !status.updateAvailable && !status.updateInProgress && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-accent" />
                {status.latestVersion ? (
                  <>
                    You&apos;re on the latest release.
                    {status.releaseUrl && (
                      <>
                        {" "}
                        <a
                          href={status.releaseUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:text-accent"
                        >
                          View release notes
                        </a>
                      </>
                    )}
                  </>
                ) : (
                  <>No published GitHub releases found yet.</>
                )}
              </div>
            )}

            {message && (
              <p className={cn("text-sm text-muted-foreground")}>{message}</p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
