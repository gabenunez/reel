import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchClient } from "./client";
import { SearchLoadingSkeleton } from "@/lib/route-loading";

export const metadata: Metadata = {
  title: "Search",
};

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchLoadingSkeleton />}>
      <SearchClient />
    </Suspense>
  );
}
