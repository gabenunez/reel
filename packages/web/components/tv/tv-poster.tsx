"use client";

import { memo } from "react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvFocusLink } from "@/components/tv/tv-focus-link";
import { cn } from "@/lib/utils";
import { Clapperboard, Tv } from "lucide-react";
import { isTvClient } from "@/lib/tv-mode-detect";

interface TvPosterProps {
  item: MediaItem;
  href?: string;
  className?: string;
  linkClassName?: string;
  progress?: number;
  subtitle?: string;
  /** Load immediately — use for the first visible row only. */
  priority?: boolean;
}

export const TvPoster = memo(function TvPoster({
  item,
  href,
  className,
  linkClassName,
  progress,
  subtitle,
  priority = false,
}: TvPosterProps) {
  const imageUrl = api.imageUrl(item.posterPath);
  const linkHref = href ?? routes.media(item.id);
  // Android TV WebView often never loads lazy images inside horizontal rows/grids.
  const loadImmediately = isTvClient() || priority;

  return (
    <div className={cn("tv-poster-tile shrink-0", className)}>
      <TvFocusLink
        href={linkHref}
        variant="poster"
        aria-label={item.title}
        className={cn("group w-[7.5rem]", linkClassName)}
      >
        <div className="tv-poster-art poster-shadow relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              loading={loadImmediately ? "eager" : "lazy"}
              decoding="async"
              {...(loadImmediately ? { fetchPriority: "high" as const } : {})}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="signal-grid flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-muted-foreground">
              {item.type === "movie" ? (
                <Clapperboard className="h-8 w-8 text-primary" />
              ) : (
                <Tv className="h-8 w-8 text-primary" />
              )}
            </div>
          )}

          {progress !== undefined && progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-white/25">
              <div
                className={cn(
                  "h-full bg-accent",
                  progress >= 99.5 ? "w-full" : "rounded-r-full",
                )}
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          )}
        </div>
        <p className="tv-poster-title mt-2 line-clamp-2 text-sm font-medium leading-snug text-muted-foreground transition-colors">
          {item.title}
        </p>
        {subtitle && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </TvFocusLink>
    </div>
  );
});
