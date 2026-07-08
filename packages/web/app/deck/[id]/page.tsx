import type { Metadata } from "next";
import { Suspense } from "react";
import { LibraryClient } from "../../library/client";
import { fetchDeck, fetchDeckItems } from "@/lib/server-api";
import { PosterGridLoadingSkeleton } from "@/lib/route-loading";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Deck",
};

export default async function DeckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deckId = parseInt(id, 10);
  if (!Number.isFinite(deckId)) {
    return (
      <Suspense fallback={<PosterGridLoadingSkeleton />}>
        <LibraryClient />
      </Suspense>
    );
  }

  const [{ data: deck }, { data: items }] = await Promise.all([
    fetchDeck(deckId),
    fetchDeckItems(deckId, 1),
  ]);

  const deckRecord = deck as {
    name?: string;
    paths?: string[];
    libraryNames?: string[];
  } | null;

  return (
    <Suspense fallback={<PosterGridLoadingSkeleton />}>
      <LibraryClient
        initialList={
          items
            ? {
                kind: "deck",
                id: deckId,
                page: items,
                title: deckRecord?.name ?? "Deck",
                subtitle: deckRecord
                  ? `${deckRecord.paths?.length ?? 0} folder${
                      (deckRecord.paths?.length ?? 0) === 1 ? "" : "s"
                    } / ${deckRecord.libraryNames?.join(", ") || "Custom deck"}`
                  : "Custom deck",
              }
            : null
        }
      />
    </Suspense>
  );
}
