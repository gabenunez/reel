"use client";

import { Suspense } from "react";
import { useMediaRouteId } from "@/lib/use-route-params";
import { useIsClient } from "@/lib/use-browser-pathname";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTvMode } from "@/lib/tv-mode";
import { TvMediaView } from "@/components/tv/views/media-view";
import { MediaDesktopSeasons } from "./media-desktop-seasons";
import { MediaHero } from "./media-hero";
import { asMediaDetail } from "./types";
import { useMediaPageData } from "@/lib/use-media-page-data";

export function MediaPageSkeleton() {
  return (
    <div>
      <Skeleton className="h-80 w-full" />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-24 w-full max-w-2xl" />
      </div>
    </div>
  );
}

/** Legacy `/media?id=` route — dynamic client fetch with Suspense. */
export function MediaClient() {
  const isTvMode = useTvMode();
  return (
    <Suspense fallback={<MediaPageSkeleton />}>
      {isTvMode ? <LegacyTvMedia /> : <LegacyDesktopMedia />}
    </Suspense>
  );
}

function LegacyDesktopMedia() {
  const isClient = useIsClient();
  const mediaId = useMediaRouteId();

  if (!mediaId || Number.isNaN(mediaId)) {
    if (!isClient) return <MediaPageSkeleton />;
    return (
      <div className="py-20 text-center">
        <p>Invalid media</p>
        <Button asChild className="mt-4">
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  return <LegacyDesktopMediaResolved mediaId={mediaId} />;
}

function LegacyDesktopMediaResolved({ mediaId }: { mediaId: number }) {
  const { media: mediaRecord } = useMediaPageData(mediaId);
  if (!mediaRecord) return <MediaPageSkeleton />;

  const media = asMediaDetail(mediaRecord);
  return (
    <>
      <MediaHero media={media} />
      <MediaDesktopSeasons media={media} />
    </>
  );
}

function LegacyTvMedia() {
  return <TvMediaView />;
}
