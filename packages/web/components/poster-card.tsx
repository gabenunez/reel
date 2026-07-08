"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { Clapperboard, Play, Tv } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { prefetchPosterNavigation } from "@/lib/prefetch-artwork";
import { cn } from "@/lib/utils";
import { MediaImage } from "@/components/media-image";

interface PosterCardProps {
  item: MediaItem;
  className?: string;
  showTitle?: boolean;
  progress?: number;
  href?: string;
  /** Load immediately — use for the first visible row/tiles. */
  priority?: boolean;
}

export const PosterCard = memo(function PosterCard({
  item,
  className,
  showTitle = true,
  progress,
  href,
  priority = false,
}: PosterCardProps) {
  const imageUrl = api.imageUrl(item.posterPath);
  const targetHref = href ?? routes.media(item.id);
  const loadImmediately = priority;

  const warmNavigation = useCallback(() => {
    prefetchPosterNavigation(item);
  }, [item]);

  return (
    <Link
      href={targetHref}
      prefetch
      className={cn("group block", className)}
      aria-label={item.title}
      onMouseEnter={warmNavigation}
      onFocus={warmNavigation}
    >
      <div className="poster-shadow relative aspect-[2/3] overflow-hidden rounded-md border border-white/10 bg-muted transition-transform duration-300 will-change-transform group-hover:-translate-y-1 group-hover:scale-[1.025]">
        <div className="absolute inset-y-0 left-0 z-10 w-1 bg-primary/0 transition-colors group-hover:bg-primary" />
        {imageUrl ? (
          <MediaImage
            src={imageUrl}
            alt={item.title}
            width={342}
            height={513}
            priority={loadImmediately}
            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 342px"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="signal-grid flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
            {item.type === "movie" ? (
              <Clapperboard className="h-9 w-9 text-primary" />
            ) : (
              <Tv className="h-9 w-9 text-primary" />
            )}
            <span className="line-clamp-3">{item.title}</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/15 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="absolute right-2 top-2 rounded border border-white/10 bg-black/55 px-1.5 py-1 font-mono text-[0.62rem] uppercase text-white/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
          {item.type === "movie" ? "Film" : "Series"}
        </div>

        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-primary text-primary-foreground shadow-[0_0_30px_hsl(var(--primary)/0.35)]">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </div>
        </div>

        {progress !== undefined && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-background/80">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        )}
      </div>

      {showTitle && (
        <div className="mt-2 px-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          {item.year && (
            <p className="font-mono text-[0.68rem] text-muted-foreground">
              {item.year}
            </p>
          )}
        </div>
      )}
    </Link>
  );
});
