"use client";

import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { TvFocusLink } from "@/components/tv/tv-focus-link";
import { cn } from "@/lib/utils";
import { Clapperboard, Play, Tv } from "lucide-react";

interface TvPosterProps {
  item: MediaItem;
  href?: string;
  className?: string;
  linkClassName?: string;
  progress?: number;
  subtitle?: string;
}

export function TvPoster({
  item,
  href,
  className,
  linkClassName,
  progress,
  subtitle,
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

          <div className="tv-poster-play absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 ease-out">
            <Play className="h-9 w-9 fill-white text-white drop-shadow-md" />
          </div>

          {progress !== undefined && progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/25">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          )}
        </div>
        <p className="tv-poster-title mt-2 line-clamp-2 text-sm font-semibold leading-snug transition-colors">
          {item.title}
        </p>
        {subtitle && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </TvFocusLink>
    </div>
  );
}
