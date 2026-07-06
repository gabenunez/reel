"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Home, Settings } from "lucide-react";
import { MediaIcon } from "@/components/media-icon";
import { mainNavGroupClassName, NavTab } from "@/components/nav-tabs";
import { SearchPopover } from "@/components/search-popover";
import { TvSpatialNav } from "@/components/tv/tv-spatial-nav";
import { UpdateAvailableButton } from "@/components/update-available-button";
import { isNavActive } from "@/lib/nav-utils";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

function TvHeader() {
  const pathname = usePathname();
  const homeActive = isNavActive(pathname, "/");
  const favoritesActive = isNavActive(pathname, "/favorites");
  const settingsActive = isNavActive(pathname, "/settings");

  return (
    <header className="sticky top-0 z-50 shrink-0 overflow-visible border-b border-border/60 bg-background/90">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <div className="flex h-16 items-center gap-3 px-4 sm:h-[4.5rem] sm:gap-4 sm:px-6">
        <Link
          href={routes.home()}
          data-tv-item=""
          tabIndex={0}
          aria-label="MEDIA! home"
          className="tv-focus-button group -my-1 flex shrink-0 items-center rounded-lg outline-none"
        >
          <MediaIcon className="h-16 w-16 transition-transform group-hover:-rotate-6 sm:h-20 sm:w-20" />
        </Link>

        <div className="hidden min-w-0 flex-1 md:block md:max-w-md lg:max-w-xl">
          <SearchPopover variant="bar" />
        </div>

        <div className="ml-auto flex min-h-9 items-center gap-2 sm:gap-2.5">
          <SearchPopover variant="icon" className="md:hidden" />

          <nav
            data-tv-row=""
            data-tv-nav-row=""
            aria-label="Main"
            className={mainNavGroupClassName}
          >
            <NavTab
              tvItem
              href={routes.home()}
              icon={Home}
              label="Home"
              active={homeActive}
            />
            <NavTab
              tvItem
              href={routes.favorites()}
              icon={Heart}
              label="Favorites"
              active={favoritesActive}
            />
            <NavTab
              tvItem
              href={routes.settings()}
              icon={Settings}
              label="Settings"
              active={settingsActive}
            />
          </nav>

          <UpdateAvailableButton tvItem />
        </div>
      </div>

      <div className="border-t border-border/40 px-4 pb-3 pt-2 md:hidden">
        <SearchPopover variant="bar" />
      </div>
    </header>
  );
}

export function TvShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideNav = pathname.startsWith("/watch");

  return (
    <TvSpatialNav>
      <div className={cn("tv-ui flex h-screen max-h-screen flex-col overflow-hidden")}>
        {!hideNav && <TvHeader />}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-6">{children}</main>
      </div>
    </TvSpatialNav>
  );
}
