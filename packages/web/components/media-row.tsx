"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PosterCard } from "./poster-card";
import { ScrollRow } from "./scroll-row";
import { api, type ContinueWatchingItem, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  href?: string;
  hideHeader?: boolean;
  /** How many leading posters get `priority` preload (default 8). */
  priorityLimit?: number;
}

export function MediaRow({
  title,
  items,
  href,
  hideHeader = false,
  priorityLimit = 8,
}: MediaRowProps) {
  if (!items.length) return null;

  return (
    <section className={hideHeader ? undefined : "mb-12"}>
      {!hideHeader && (
        <div className="mx-auto mb-4 flex max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-primary" />
            <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
          </div>
          {href && (
            <Link
              href={href}
              className="flex items-center gap-1 text-sm text-primary transition-colors hover:text-accent"
            >
              See all <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
      <ScrollRow className="mx-auto max-w-7xl" contentClassName="px-4 sm:px-6">
        {items.map((item, index) => (
          <PosterCard
            key={item.id}
            item={item}
            priority={index < priorityLimit}
            className="w-36 shrink-0 snap-start sm:w-44"
          />
        ))}
      </ScrollRow>
    </section>
  );
}

interface ContinueWatchingRowProps {
  items: ContinueWatchingItem[];
  hideHeader?: boolean;
  /** How many leading posters get `priority` preload (default 6). */
  priorityLimit?: number;
}

export function ContinueWatchingRow({
  items,
  hideHeader = false,
  priorityLimit = 6,
}: ContinueWatchingRowProps) {
  if (!items.length) return null;

  return (
    <section className={hideHeader ? undefined : "mb-12"}>
      {!hideHeader && (
        <div className="mx-auto mb-4 flex max-w-7xl items-center gap-3 px-4 sm:px-6">
          <span className="h-px w-8 bg-accent" />
          <h2 className="text-lg font-semibold sm:text-xl">Continue Watching</h2>
        </div>
      )}
      <ScrollRow className="mx-auto max-w-7xl" contentClassName="px-4 sm:px-6">
        {items.map((item, index) => (
          <div key={item.id} className="w-44 shrink-0 snap-start sm:w-56">
            <PosterCard
              priority={index < priorityLimit}
              href={
                item.itemType === "movie"
                  ? routes.watch("movie", item.itemId, item.mediaId)
                  : routes.watch("episode", item.itemId, item.mediaId)
              }
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
              <p className="mt-1 truncate px-1 font-mono text-[0.68rem] text-muted-foreground">
                {item.subtitle}
              </p>
            )}
          </div>
        ))}
      </ScrollRow>
    </section>
  );
}
