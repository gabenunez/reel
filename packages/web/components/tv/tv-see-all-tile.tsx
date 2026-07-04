"use client";

import type { ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { TvFocusLink } from "@/components/tv/tv-focus-link";
import { cn } from "@/lib/utils";

interface TvSeeAllTileProps {
  href: string;
  label: string;
  detail?: string;
  className?: string;
}

/** Poster-sized tile at the end of a row — opens a full list page (not a header link). */
export function TvSeeAllTile({ href, label, detail, className }: TvSeeAllTileProps) {
  return (
    <div className={cn("tv-poster-tile shrink-0 snap-center", className)}>
      <TvFocusLink
        href={href}
        variant="poster"
        aria-label={label}
        className="group w-[7.5rem]"
      >
        <div className="tv-poster-art relative flex aspect-[2/3] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-primary/35 bg-primary/5">
          <LayoutGrid className="h-8 w-8 text-primary" />
        </div>
        <p className="tv-poster-title mt-2 line-clamp-2 text-sm font-semibold leading-snug">
          {label}
        </p>
        {detail ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </TvFocusLink>
    </div>
  );
}

interface TvBrowseCardProps {
  href: string;
  title: string;
  detail?: string;
  icon?: ReactNode;
  className?: string;
}

/** Wide browse card used in the home collections row. */
export function TvBrowseCard({
  href,
  title,
  detail,
  icon,
  className,
}: TvBrowseCardProps) {
  return (
    <TvFocusLink
      href={href}
      variant="card"
      className={cn(
        "w-44 shrink-0 snap-center rounded-lg border border-border/80 bg-card p-3",
        className,
      )}
    >
      {icon ? <div className="mb-1.5">{icon}</div> : null}
      <p className="truncate text-sm font-semibold">{title}</p>
      {detail ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </TvFocusLink>
  );
}
