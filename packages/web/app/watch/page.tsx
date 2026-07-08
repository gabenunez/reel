import type { Metadata } from "next";
import { WatchPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "Watch",
};

export default function WatchPage() {
  return <WatchPageClient />;
}
