"use client";

import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTvMode } from "@/lib/tv-mode";
import type { ReactNode } from "react";

function RouteLoading({ children }: { children: ReactNode }) {
  const isTvMode = useTvMode();

  if (isTvMode) {
    return (
      <div
        data-tv-route-loading=""
        className="flex min-h-[55vh] items-center justify-center bg-background px-8"
        role="status"
        aria-label="Loading"
      >
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-card/90 px-5 py-3 text-sm text-muted-foreground shadow-xl">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          Loading...
        </div>
      </div>
    );
  }

  return children;
}

export function HomeLoadingSkeleton() {
  return <RouteLoading>
    <div className="pb-16">
      <Skeleton className="mb-14 h-96 w-full" />
      <div className="mx-auto max-w-7xl space-y-12 px-4 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-32 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  </RouteLoading>;
}

export function PosterGridLoadingSkeleton() {
  return <RouteLoading>
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Skeleton className="mb-8 h-10 w-48" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] rounded-md" />
        ))}
      </div>
    </div>
  </RouteLoading>;
}

export function BrowseLoadingSkeleton() {
  return <RouteLoading>
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Skeleton className="mb-8 h-10 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-md" />
        ))}
      </div>
    </div>
  </RouteLoading>;
}

export function WatchLoadingSkeleton() {
  const isTvMode = useTvMode();

  // Full-bleed black cover — must sit above the TV rail so media→watch does not
  // flash a padded centered card while the sidebar width changes.
  if (isTvMode) {
    return (
      <div
        data-tv-route-loading=""
        data-tv-watch-loading=""
        className="fixed inset-0 z-40 flex items-center justify-center bg-black"
        role="status"
        aria-label="Loading"
      >
        <Loader2 className="h-9 w-9 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Skeleton className="h-10 w-40" />
    </div>
  );
}

export function SettingsLoadingSkeleton() {
  return <RouteLoading>
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <Skeleton className="h-10 w-32" />
      <Skeleton className="h-48 w-full rounded-md" />
      <Skeleton className="h-48 w-full rounded-md" />
    </div>
  </RouteLoading>;
}

export function SearchLoadingSkeleton() {
  return <RouteLoading>
    <div className="flex min-h-[50vh] items-center justify-center px-6">
      <Skeleton className="h-10 w-56" />
    </div>
  </RouteLoading>;
}
