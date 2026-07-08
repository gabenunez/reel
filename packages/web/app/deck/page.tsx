import type { Metadata } from "next";
import { Suspense } from "react";
import { LibraryClient } from "../library/client";
import { PosterGridLoadingSkeleton } from "@/lib/route-loading";

export const metadata: Metadata = {
  title: "Decks",
};

export default function DeckPage() {
  return (
    <Suspense fallback={<PosterGridLoadingSkeleton />}>
      <LibraryClient />
    </Suspense>
  );
}
