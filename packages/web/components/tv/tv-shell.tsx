"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Home, Heart, LogOut, Search } from "lucide-react";
import { useAuth } from "@/components/auth-gate";
import { ReelIcon } from "@/components/reel-icon";
import { TvSpatialNav } from "@/components/tv/tv-spatial-nav";
import { tvNavItemClassName } from "@/components/tv/tv-focus-link";
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
    <button
      type="button"
      data-tv-item=""
      title="Sign out"
      aria-label="Sign out"
      onClick={onLogout}
      className={cn(
        "flex h-11 w-11 items-center justify-center text-muted-foreground",
        tvNavItemClassName,
      )}
    >
      <LogOut className="h-5 w-5" />
    </button>
  );
}

export function TvShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { required, authenticated, logout } = useAuth();
  const hideNav = pathname.startsWith("/watch");
  const homeActive = pathname === "/";
  const favoritesActive = pathname.startsWith("/favorites");
  const searchActive = pathname.startsWith("/search");
  const showLogout = required && authenticated;

  const handleLogout = () => {
    void logout();
  };

  return (
    <TvSpatialNav>
      <div className="tv-ui flex min-h-screen">
        {!hideNav && (
          <aside className="flex w-[4.25rem] shrink-0 flex-col items-center border-r border-border/50 bg-background/95 py-5 min-h-screen">
            <div className="mb-6 flex h-9 w-9 items-center justify-center" aria-hidden="true">
              <ReelIcon className="h-9 w-9 opacity-90" />
            </div>

            <nav
              data-tv-row=""
              data-tv-nav-row=""
              data-tv-vertical=""
              className="flex flex-1 flex-col items-center gap-1.5"
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
              {showLogout && (
                <>
                  <div className="min-h-4 flex-1" aria-hidden="true" />
                  <TvLogoutButton onLogout={handleLogout} />
                </>
              )}
            </nav>
          </aside>
        )}

        <main className="min-w-0 flex-1 pb-6">{children}</main>
      </div>
    </TvSpatialNav>
  );
}
