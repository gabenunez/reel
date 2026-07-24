"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useBrowserPathname } from "@/lib/use-browser-pathname";
import type { ReactNode } from "react";
import { Home, Heart, LogOut, Search } from "lucide-react";
import { useAuth } from "@/components/auth-gate";
import { MediaIcon } from "@/components/media-icon";
import { TvSpatialNav } from "@/components/tv/tv-spatial-nav";
import { tvNavItemClassName, TvFocusButton } from "@/components/tv/tv-focus-link";
import {
  nativeTvPlayerAvailable,
  setNativeWebOverlayAlpha,
  stopNativePlayback,
} from "@/lib/android-bridge";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

function TvNavButton({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-tv-item=""
      tabIndex={0}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      {...(active ? { "data-tv-nav-active": "" as const } : {})}
      className={cn(
        "flex h-11 w-11 items-center justify-center",
        tvNavItemClassName,
        !active && "text-muted-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function TvLogoutButton({ onLogout }: { onLogout: () => void }) {
  return (
    <TvFocusButton
      variant="nav"
      title="Sign out"
      aria-label="Sign out"
      onClick={onLogout}
      className="flex h-11 w-11 items-center justify-center text-muted-foreground"
    >
      <LogOut className="h-5 w-5" />
    </TvFocusButton>
  );
}

export function TvShell({ children }: { children: React.ReactNode }) {
  const pathname = useBrowserPathname();
  const wasOnWatchRef = useRef(false);
  const { required, authenticated, logout } = useAuth();
  const onWatch = pathname.startsWith("/watch");
  const homeActive = pathname === "/";
  const favoritesActive = pathname.startsWith("/favorites");
  const searchActive = pathname.startsWith("/search");
  const showLogout = required && authenticated;

  useEffect(() => {
    // Set before watch-view mounts so loading.tsx / CSS can cover the rail
    // without waiting for the player client bundle.
    if (onWatch) {
      document.documentElement.setAttribute("data-tv-watch-active", "true");
    } else {
      document.documentElement.removeAttribute("data-tv-watch-active");
    }

    let stopFrame: number | null = null;
    if (wasOnWatchRef.current && !onWatch) {
      if (nativeTvPlayerAvailable()) {
        // Let the destination page paint over the native surface first. The
        // old order exposed the Activity's black background for one frame.
        document.documentElement.removeAttribute("data-native-video");
        setNativeWebOverlayAlpha(1);
        stopFrame = requestAnimationFrame(() => stopNativePlayback());
      }
      document.querySelector("video")?.pause();
    }
    wasOnWatchRef.current = onWatch;
    return () => {
      if (stopFrame !== null) cancelAnimationFrame(stopFrame);
    };
  }, [onWatch]);

  const handleLogout = () => {
    void logout();
  };

  return (
    <TvSpatialNav>
      <div className="tv-ui flex h-screen max-h-screen overflow-hidden">
        {/*
          Keep the rail mounted on /watch (invisible) so main width never jumps
          when navigating media → player. Unmounting caused the hero/poster/actions
          to reflow ~4–5rem wider for a frame before the fixed player covered them.
        */}
        <aside
          className={cn(
            "flex w-[4.25rem] shrink-0 flex-col items-center border-r border-border/50 bg-background/95 py-5 min-h-screen",
            onWatch && "invisible pointer-events-none",
          )}
          aria-hidden={onWatch || undefined}
        >
            <div
              data-tv-logo=""
              className="mb-5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-transparent"
              aria-hidden="true"
            >
              <MediaIcon background={false} combined className="h-6 w-6" />
            </div>

            <nav
              data-tv-row=""
              data-tv-nav-row=""
              data-tv-vertical=""
              className="flex flex-col items-center gap-2"
            >
              <TvNavButton href={routes.home()} label="Home" active={homeActive}>
                <Home className="h-5 w-5" />
              </TvNavButton>
              <TvNavButton
                href={routes.favorites()}
                label="Favorites"
                active={favoritesActive}
              >
                <Heart className="h-5 w-5" />
              </TvNavButton>
              <TvNavButton href={routes.search()} label="Search" active={searchActive}>
                <Search className="h-5 w-5" />
              </TvNavButton>
              {showLogout && <TvLogoutButton onLogout={handleLogout} />}
            </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-background pb-6">{children}</main>
      </div>
    </TvSpatialNav>
  );
}
