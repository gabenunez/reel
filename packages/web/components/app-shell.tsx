"use client";

import { useEffect } from "react";
import { AuthProvider } from "@/components/auth-gate";
import { AudioUnlock } from "@/components/audio-unlock";
import { ThemeMusicSettingsProvider } from "@/components/theme-music-settings";
import { SubtitleStylesProvider } from "@/components/subtitle-style-settings";
import { ScanStatusProvider } from "@/components/scan-status-provider";
import { UpdateStatusProvider } from "@/components/update-status-provider";
import { UpdateModal } from "@/components/update-modal";
import { Navbar } from "@/components/navbar";
import { ScanStatusBar } from "@/components/scan-status-bar";
import { TvShell } from "@/components/tv/tv-shell";
import { TvModeProvider, useTvMode } from "@/lib/tv-mode";
import {
  clearStaleChunkReloadGuard,
  installStaleChunkRecovery,
} from "@/lib/stale-chunk-recovery";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const isTvMode = useTvMode();

  useEffect(() => {
    installStaleChunkRecovery();
    const timer = window.setTimeout(clearStaleChunkReloadGuard, 5_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <AuthProvider>
      <SubtitleStylesProvider>
        <ThemeMusicSettingsProvider>
          <AudioUnlock />
          <UpdateStatusProvider>
            <UpdateModal />
            {isTvMode ? (
              <TvShell>{children}</TvShell>
            ) : (
              <div data-web-only>
                <ScanStatusProvider>
                  <Navbar />
                  <ScanStatusBar />
                  <main>{children}</main>
                </ScanStatusProvider>
              </div>
            )}
          </UpdateStatusProvider>
        </ThemeMusicSettingsProvider>
      </SubtitleStylesProvider>
    </AuthProvider>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TvModeProvider>
      <AppShellInner>{children}</AppShellInner>
    </TvModeProvider>
  );
}
