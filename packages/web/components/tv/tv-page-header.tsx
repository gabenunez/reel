"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TvFocusButton, TvFocusLink } from "@/components/tv/tv-focus-link";
import { cn } from "@/lib/utils";

interface TvPageHeaderProps {
  backHref: string;
  backLabel?: string;
  title: string;
  eyebrow?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/** Compact TV page chrome: back control + title in one focus row. */
export function TvPageHeader({
  backHref,
  backLabel = "Back",
  title,
  eyebrow,
  trailing,
  className,
}: TvPageHeaderProps) {
  return (
    <div
      data-tv-row=""
      data-tv-content-row=""
      className={cn(
        "mb-4 flex items-center justify-between gap-4 border-b border-border/60 pb-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <TvFocusLink
          href={backHref}
          aria-label={backLabel}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/70"
        >
          <ChevronLeft className="h-5 w-5" />
        </TvFocusLink>
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
        </div>
      </div>
      {trailing ? <div className="shrink-0 text-xs text-muted-foreground">{trailing}</div> : null}
    </div>
  );
}

interface TvSectionLabelProps {
  children: ReactNode;
  className?: string;
}

export function TvSectionLabel({ children, className }: TvSectionLabelProps) {
  return (
    <h2 className={cn("mb-2 px-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground", className)}>
      {children}
    </h2>
  );
}

interface TvPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function TvPagination({ page, totalPages, onPageChange, className }: TvPaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div
      data-tv-row=""
      data-tv-content-row=""
      className={cn(
        "flex items-center justify-center gap-2 border-t border-border/50 pt-4",
        className,
      )}
    >
      <TvFocusButton
        variant="nav"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" /> Prev
      </TvFocusButton>
      <span className="px-2 text-xs tabular-nums text-muted-foreground">
        {page} / {totalPages}
      </span>
      <TvFocusButton
        variant="nav"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        Next <ChevronRight className="h-4 w-4" />
      </TvFocusButton>
    </div>
  );
}
