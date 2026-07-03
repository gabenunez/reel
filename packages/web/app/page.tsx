"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Film, Loader2, Tv } from "lucide-react";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { ContinueWatchingRow, MediaRow } from "@/components/media-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LibraryIcon } from "@/components/navbar";

export default function HomePage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getHome>> | null>(
    null,
  );
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof api.getStatus>
  > | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getHome(), api.getStatus()])
      .then(([home, stat]) => {
        setData(home);
        setStatus(stat);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Skeleton className="mb-8 h-12 w-64" />
        <div className="flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-44 shrink-0 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const isScanning = status?.activeScan?.status === "running";

  return (
    <div className="pb-16">
      <section className="relative mb-12 overflow-hidden px-6 py-16">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-7xl">
          <h1 className="mb-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Welcome to <span className="text-primary">Reel</span>
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Your personal media server. Stream your movies and TV shows anywhere
            on your network.
          </p>

          {isScanning && (
            <div className="mt-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-medium">
                  Scanning {status?.activeScan?.libraryName}...
                </p>
                <p className="text-sm text-muted-foreground">
                  {status?.activeScan?.message} ({status?.activeScan?.progress}%)
                </p>
              </div>
            </div>
          )}

          {!status?.tmdbConfigured && (
            <div className="mt-6 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
              <p className="text-sm text-yellow-200">
                TMDB API key not configured. Add your key in{" "}
                <Link href="/settings" className="underline">
                  Settings
                </Link>{" "}
                for rich metadata and posters.
              </p>
            </div>
          )}
        </div>
      </section>

      {data && <ContinueWatchingRow items={data.continueWatching} />}

      {data && (
        <MediaRow title="Recently Added" items={data.recentlyAdded} />
      )}

      {data?.libraries && data.libraries.length > 0 && (
        <section className="mb-10 px-6">
          <h2 className="mb-4 text-xl font-semibold">Your Libraries</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.libraries.map((lib) => (
              <Link
                key={lib.id}
                href={routes.library(lib.id)}
                className="group flex items-center gap-4 rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:bg-card/80"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <LibraryIcon type={lib.type} />
                </div>
                <div>
                  <h3 className="font-semibold group-hover:text-primary">
                    {lib.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {lib.type === "movies" ? "Movies" : "TV Shows"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {(!data?.libraries?.length || !data.recentlyAdded?.length) && !isScanning && (
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <Film className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
          <h2 className="mb-2 text-2xl font-semibold">No media yet</h2>
          <p className="mb-6 text-muted-foreground">
            Add your movie and TV folders in Settings — Reel will scan them
            automatically.
          </p>
          <Button asChild>
            <Link href="/settings">Go to Settings</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
