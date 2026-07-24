"use client";

import { Suspense, useEffect } from "react";
import { WatchClient } from "./client";
import { reloadForFreshAssets } from "@/lib/stale-chunk-recovery";

const WATCH_LOAD_TIMEOUT_MS = 12_000;

function WatchRouteLoading() {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      reloadForFreshAssets("watch-route-load-timeout");
    }, WATCH_LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div
      data-tv-watch-loading=""
      className="fixed inset-0 z-40 flex items-center justify-center bg-black"
    >
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function WatchPageClient() {
  return (
    <Suspense fallback={<WatchRouteLoading />}>
      <WatchClient />
    </Suspense>
  );
}
