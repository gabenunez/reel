"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Film, Home, Settings, Tv } from "lucide-react";
import { UpdateAvailableButton } from "@/components/update-available-button";
import { SearchPopover } from "@/components/search-popover";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navbar() {
  const pathname = usePathname();

  if (pathname.startsWith("/watch")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-primary/40 bg-background shadow-[0_0_28px_hsl(var(--primary)/0.18)]">
            <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
            <Clapperboard className="h-5 w-5 text-primary transition-transform group-hover:-rotate-6" />
          </div>
          <div className="leading-none">
            <span className="block text-lg font-bold">Reel</span>
            <span className="hidden font-mono text-[0.62rem] uppercase text-muted-foreground sm:block">
              Local signal
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <UpdateAvailableButton />
          <SearchPopover />
          <nav className="flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:px-4",
                  pathname === href
                    ? "bg-primary/[0.12] text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
                {pathname === href && (
                  <span className="absolute inset-x-3 bottom-1 h-px bg-primary/70" />
                )}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}

export function LibraryIcon({ type }: { type: "movies" | "tv" }) {
  return type === "movies" ? (
    <Film className="h-5 w-5" />
  ) : (
    <Tv className="h-5 w-5" />
  );
}
