"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { forwardRef, type ComponentProps } from "react";

/** Side rail nav icons */
export const tvNavItemClassName =
  "tv-focus-nav rounded-lg border-2 border-transparent outline-none ring-0 shadow-none transition-colors duration-75 ease-out";

/** Standard TV buttons (back, pagination, play controls on light bg) */
export const tvFocusRingClassName =
  "tv-focus-button rounded-lg border-2 border-transparent outline-none ring-0 shadow-none transition-colors duration-75 ease-out";

/** Poster tiles — focus styling lives on the art via globals.css */
export const tvPosterLinkClassName =
  "tv-poster-link block shrink-0 outline-none ring-0 shadow-none";

/** List rows, episode cards, menu items */
export const tvCardLinkClassName =
  "tv-focus-card block rounded-lg border-2 border-transparent outline-none ring-0 shadow-none transition-colors duration-75 ease-out";

/** Filter / season tabs — selected state via data-tv-selected */
export const tvChipClassName =
  "tv-focus-chip shrink-0 snap-center rounded-lg border-2 border-transparent outline-none ring-0 shadow-none transition-colors duration-75 ease-out";

function focusSelectedProps(selected?: boolean) {
  return selected ? ({ "data-tv-selected": "" as const }) : {};
}

export function TvFocusLink({
  className,
  variant = "default",
  selected,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: "default" | "poster" | "card" | "nav" | "chip";
  selected?: boolean;
}) {
  return (
    <Link
      data-tv-item=""
      tabIndex={0}
      className={cn(
        variant === "poster"
          ? tvPosterLinkClassName
          : variant === "card"
            ? tvCardLinkClassName
            : variant === "nav"
              ? tvNavItemClassName
              : variant === "chip"
                ? tvChipClassName
                : tvFocusRingClassName,
        className,
      )}
      {...focusSelectedProps(selected)}
      {...props}
    />
  );
}

export const TvFocusButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & {
    variant?: "default" | "card" | "nav" | "chip";
    selected?: boolean;
  }
>(function TvFocusButton({ className, variant = "default", selected, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-tv-item=""
      tabIndex={0}
      className={cn(
        variant === "card"
          ? tvCardLinkClassName
          : variant === "nav"
            ? tvNavItemClassName
            : variant === "chip"
              ? tvChipClassName
              : tvFocusRingClassName,
        className,
      )}
      {...focusSelectedProps(selected)}
      {...props}
    />
  );
});
