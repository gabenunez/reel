import { Suspense } from "react";
import { SearchClient } from "./client";

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="px-6 py-10">Loading...</div>}>
      <SearchClient />
    </Suspense>
  );
}
