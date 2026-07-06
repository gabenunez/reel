import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const mainNavGroupClassName =
  "flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/25 p-0.5";

export function navTabClassName(active: boolean, compact = true) {
  return cn(
    "relative flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-all outline-none",
    compact ? "h-9 w-9" : "h-9 px-3.5 sm:px-4",
    active
      ? "bg-background text-primary shadow-sm ring-1 ring-primary/35"
      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
  );
}

export function NavTab({
  href,
  icon: Icon,
  label,
  active,
  compact = true,
  tvItem = false,
  className,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  compact?: boolean;
  tvItem?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={label}
      {...(tvItem
        ? {
            "data-tv-item": "" as const,
            tabIndex: 0,
            ...(active ? { "data-tv-nav-active": "" as const } : {}),
          }
        : {})}
      className={cn(navTabClassName(active, compact), tvItem && "tv-focus-nav", className)}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!compact && <span className="hidden sm:inline">{label}</span>}
    </Link>
  );
}
