"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { forwardRef, type ComponentProps } from "react";

/** Side rail nav — soft highlight, no outer ring. */
export const tvNavItemClassName =
  "rounded-lg outline-none ring-0 shadow-none transition-[background-color,transform,color] duration-150 ease-out focus:ring-0 focus-visible:ring-0 data-[tv-focused]:ring-0 data-[tv-focused]:scale-105 data-[tv-focused]:bg-muted/80 data-[tv-focused]:text-foreground";

/** Ring highlight for compact buttons in panels. */
export const tvFocusRingClassName =
  "rounded-lg outline-none transition-shadow focus:ring-2 focus:ring-primary/70 focus:ring-offset-1 focus:ring-offset-background focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[tv-focused]:ring-2 data-[tv-focused]:ring-primary/70 data-[tv-focused]:ring-offset-1 data-[tv-focused]:ring-offset-background";

/** Poster tiles — focus styling lives on the art via globals.css, not rings/borders. */
export const tvPosterLinkClassName =
  "tv-poster-link block shrink-0 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus:shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none data-[tv-focused]:outline-none data-[tv-focused]:ring-0 data-[tv-focused]:shadow-none";

/** Wide list/card links — subtle fill on focus, no outer ring. */
export const tvCardLinkClassName =
  "tv-focus-card block outline-none rounded-lg transition-colors focus:ring-0 focus-visible:ring-0 data-[tv-focused]:ring-0";

export function TvFocusLink({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof Link> & { variant?: "default" | "poster" | "card" | "nav" }) {
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
              : tvFocusRingClassName,
        className,
      )}
      {...props}
    />
  );
}

export const TvFocusButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { variant?: "default" | "card" | "nav" }
>(function TvFocusButton({ className, variant = "default", ...props }, ref) {
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
            : tvFocusRingClassName,
        className,
      )}
      {...props}
    />
  );
});
