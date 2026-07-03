"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PosterCard } from "./poster-card";
import { api, type ContinueWatchingItem, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  href?: string;
}

export function MediaRow({ title, items, href }: MediaRowProps) {
  if (!items.length) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between px-6">
        <h2 className="text-xl font-semibold">{title}</h2>
        {href && (
          <Link
            href={href}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            See all <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto px-6 pb-2 scrollbar-hide">
        {items.map((item) => (
          <PosterCard key={item.id} item={item} className="w-36 shrink-0 sm:w-44" />
        ))}
      </div>
    </section>
  );
}

interface ContinueWatchingRowProps {
  items: ContinueWatchingItem[];
}

export function ContinueWatchingRow({ items }: ContinueWatchingRowProps) {
  if (!items.length) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-4 px-6 text-xl font-semibold">Continue Watching</h2>
      <div className="flex gap-4 overflow-x-auto px-6 pb-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={
              item.itemType === "movie"
                ? routes.watch("movie", item.itemId, item.mediaId)
                : routes.watch("episode", item.itemId, item.mediaId)
            }
            className="w-56 shrink-0"
          >
            <PosterCard
              item={{
                id: item.mediaId,
                libraryId: 0,
                title: item.title,
                type: item.itemType === "movie" ? "movie" : "tv",
                posterPath: item.posterPath,
              }}
              progress={item.percent}
            />
            {item.subtitle && (
              <p className="mt-1 truncate px-1 text-xs text-muted-foreground">
                {item.subtitle}
              </p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
