"use client";

import { ThemeMusicProvider } from "@/components/theme-music-player";
import { ThemeMusicMuteButton } from "@/components/theme-music-settings";
import { useDocumentTitle } from "@/lib/use-document-title";

export function MediaDocumentTitle({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}

export function MediaThemeShell({
  mediaId,
  children,
}: {
  mediaId: number;
  children: React.ReactNode;
}) {
  return (
    <ThemeMusicProvider mediaId={mediaId}>
      <ThemeMusicMuteButton className="fixed top-20 right-4 z-50 sm:right-6" />
      {children}
    </ThemeMusicProvider>
  );
}
