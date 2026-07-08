import type { Metadata } from "next";
import { Suspense } from "react";
import { LibraryClient } from "../client";
import { fetchLibraryItems } from "@/lib/server-api";
import { PosterGridLoadingSkeleton } from "@/lib/route-loading";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Library",
};

export default async function LibraryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const libraryId = parseInt(id, 10);
  const { data } = Number.isFinite(libraryId)
    ? await fetchLibraryItems(libraryId, 1)
    : { data: null };

  return (
    <Suspense fallback={<PosterGridLoadingSkeleton />}>
      <LibraryClient
        initialList={
          data
            ? {
                kind: "library",
                id: libraryId,
                page: data,
                title: "Browse Titles",
                subtitle: "Full library",
              }
            : null
        }
      />
    </Suspense>
  );
}
