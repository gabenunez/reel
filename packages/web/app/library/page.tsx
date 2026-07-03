import { Suspense } from "react";
import { LibraryClient } from "./client";
import { Skeleton } from "@/components/ui/skeleton";

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-6 py-10">
          <Skeleton className="mb-8 h-10 w-48" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
            ))}
          </div>
        </div>
      }
    >
      <LibraryClient />
    </Suspense>
  );
}
