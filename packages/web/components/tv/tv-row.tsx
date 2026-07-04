"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TvFocusButton } from "@/components/tv/tv-focus-link";
import { TvSeeAllTile } from "@/components/tv/tv-see-all-tile";

const tvScrollRowClassName =
  "tv-scroll-row scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-8 pt-4 pb-3";

interface TvRowProps {
  title: string;
  children: ReactNode;
  className?: string;
  seeAllHref?: string;
  seeAllLabel?: string;
  seeAllDetail?: string;
}

export function TvRow({
  title,
  children,
  className,
  seeAllHref,
  seeAllLabel = "See all",
  seeAllDetail,
}: TvRowProps) {
  return (
    <section className={cn("tv-row-section mb-5", className)}>
      <h2 className="mb-2 px-8 text-base font-semibold tracking-tight text-muted-foreground">
        {title}
      </h2>
      <div
        data-tv-row=""
        data-tv-content-row=""
        data-tv-scroll-row=""
        className={tvScrollRowClassName}
      >
        {children}
        {seeAllHref ? (
          <TvSeeAllTile
            href={seeAllHref}
            label={seeAllLabel}
            detail={seeAllDetail}
          />
        ) : null}
      </div>
    </section>
  );
}

interface TvGridProps {
  children: ReactNode;
  className?: string;
}

export function TvGrid({ children, className }: TvGridProps) {
  return (
    <div
      data-tv-row=""
      data-tv-content-row=""
      data-tv-grid=""
      className={cn(
        "grid grid-cols-4 gap-x-3 gap-y-6 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export { tvScrollRowClassName };
