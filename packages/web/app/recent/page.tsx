import type { Metadata } from "next";
import { Suspense } from "react";
import { RecentClient } from "./client";
import { fetchRecentlyAdded } from "@/lib/server-api";
import { PosterGridLoadingSkeleton } from "@/lib/route-loading";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Recently Added",
};

export default async function RecentPage() {
  const { data: initialPage } = await fetchRecentlyAdded(1);
  return (
    <Suspense fallback={<PosterGridLoadingSkeleton />}>
      <RecentClient initialPage={initialPage} />
    </Suspense>
  );
}
