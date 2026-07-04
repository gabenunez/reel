"use client";

import { memo } from "react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvFocusLink } from "@/components/tv/tv-focus-link";
import { cn } from "@/lib/utils";
import { Clapperboard, Tv } from "lucide-react";

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

  return (
    <div className={cn("tv-poster-tile shrink-0 snap-center", className)}>
      <TvFocusLink
        href={linkHref}
        variant="poster"
        aria-label={item.title}
        className={cn("group w-[7.5rem]", linkClassName)}
      >
        <div className="tv-poster-art poster-shadow relative aspect-[2/3] rounded-lg bg-muted">
          <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt=""
                loading={priority ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={priority ? "high" : "auto"}
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
          </div>

          {progress !== undefined && progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 z-10 h-1 bg-white/25">
              <div
                className="h-full bg-accent"
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
