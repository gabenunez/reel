import { Suspense } from "react";
import { WatchClient } from "./client";

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-black">Loading...</div>}>
      <WatchClient />
    </Suspense>
  );
}
