"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, Heart, Home, Settings, Tv } from "lucide-react";
import { MediaIcon } from "@/components/media-icon";
import { mainNavGroupClassName, NavTab } from "@/components/nav-tabs";
import { SearchPopover } from "@/components/search-popover";
import { UpdateAvailableButton } from "@/components/update-available-button";
import { isNavActive } from "@/lib/nav-utils";

export function Navbar() {
  const pathname = usePathname();

  if (pathname.startsWith("/watch")) {
    return null;
  }

  const homeActive = isNavActive(pathname, "/");
  const favoritesActive = isNavActive(pathname, "/favorites");
  const settingsActive = isNavActive(pathname, "/settings");

  return (
    <header className="sticky top-0 z-50 overflow-visible border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-[4.5rem] sm:gap-4 sm:px-6">
        <Link
          href="/"
          aria-label="MEDIA! home"
          className="group -my-1 flex shrink-0 items-center rounded-lg outline-none ring-primary/40 focus-visible:ring-2 sm:-my-1.5"
        >
          <MediaIcon className="h-20 w-20 transition-transform group-hover:-rotate-6 sm:h-24 sm:w-24" />
        </Link>

        <div className="hidden min-w-0 flex-1 md:block md:max-w-md lg:max-w-xl">
          <SearchPopover variant="bar" />
        </div>

        <div className="ml-auto flex min-h-9 items-center gap-2 sm:gap-2.5">
          <SearchPopover variant="icon" className="hidden sm:block md:hidden" />

          <nav aria-label="Main" className={mainNavGroupClassName}>
            <NavTab href="/" icon={Home} label="Home" active={homeActive} compact />
            <NavTab
              href="/favorites/"
              icon={Heart}
              label="Favorites"
              active={favoritesActive}
              compact
            />
            <NavTab
              href="/settings/"
              icon={Settings}
              label="Settings"
              active={settingsActive}
              compact
            />
          </nav>

          <div className="min-h-9">
            <UpdateAvailableButton />
          </div>
        </div>
      </div>

      <div className="border-t border-border/40 px-4 pb-3 pt-2 sm:hidden">
        <SearchPopover variant="bar" />
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
