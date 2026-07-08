import type { Metadata } from "next";
import { Suspense } from "react";
import { FavoritesClient } from "../client";
import { fetchFavorites } from "@/lib/server-api";
import { PosterGridLoadingSkeleton } from "@/lib/route-loading";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ filter: string }>;
}): Promise<Metadata> {
  const { filter } = await params;
  if (filter === "movie") return { title: "Favorite Films" };
  if (filter === "tv") return { title: "Favorite Series" };
  return { title: "Favorites" };
}

export default async function FavoritesFilterPage({
  params,
}: {
  params: Promise<{ filter: string }>;
}) {
  const { filter } = await params;
  const type = filter === "movie" || filter === "tv" ? filter : undefined;
  const { data: initialPage } = await fetchFavorites(1, type);
  return (
    <Suspense fallback={<PosterGridLoadingSkeleton />}>
      <FavoritesClient initialPage={initialPage} />
    </Suspense>
  );
}
