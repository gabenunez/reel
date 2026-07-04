"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  History,
  Loader2,
  Lock,
  LogOut,
  XCircle,
  Subtitles,
} from "lucide-react";
import { api, type AppSettings, type PlexImportPreview } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiKeysSettings } from "@/components/api-keys-settings";
import { LibraryManager } from "@/components/library-manager";
import { DeckManager } from "@/components/deck-manager";
import { UpdateManager } from "@/components/update-manager";
import { SettingsSection } from "@/components/settings-shell";
import { SubtitleAppearanceSettings } from "@/components/subtitle-style-settings";
import { useDocumentTitle } from "@/lib/use-document-title";

export function SettingsClient() {
  useDocumentTitle("Settings");
  const { logout, refresh: refreshAuth } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [plexPreview, setPlexPreview] = useState<PlexImportPreview | null>(null);
  const [plexPath, setPlexPath] = useState("");
  const [plexOverwrite, setPlexOverwrite] = useState(false);
  const [plexLoading, setPlexLoading] = useState(false);
  const [plexImporting, setPlexImporting] = useState(false);
  const [plexMessage, setPlexMessage] = useState<string | null>(null);

  const loadSettings = useCallback((options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    api
      .getSettings()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSettings();
    const interval = setInterval(() => loadSettings({ silent: true }), 5000);
    return () => clearInterval(interval);
  }, [loadSettings]);

  const loadPlexPreview = useCallback(async (path?: string) => {
    setPlexLoading(true);
    setPlexMessage(null);
    try {
      const preview = await api.previewPlexImport(path);
      setPlexPreview(preview);
      if (preview.dbPath && !path) {
        setPlexPath(preview.dbPath);
      }
    } catch (err) {
      setPlexMessage(err instanceof Error ? err.message : "Failed to detect Plex");
      setPlexPreview(null);
    } finally {
      setPlexLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlexPreview();
  }, [loadPlexPreview]);

  const handleImportPlex = async () => {
    setPlexImporting(true);
    setPlexMessage(null);
    try {
      const result = await api.importPlexWatchProgress({
        plexDbPath: plexPath.trim() || undefined,
        overwrite: plexOverwrite,
      });
      const parts = [
        `${result.imported} imported`,
        result.updated > 0 ? `${result.updated} updated` : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
        result.unmatched > 0 ? `${result.unmatched} unmatched` : null,
      ].filter(Boolean);
      setPlexMessage(`Import complete: ${parts.join(", ")}.`);
      await loadPlexPreview(plexPath.trim() || undefined);
    } catch (err) {
      setPlexMessage(err instanceof Error ? err.message : "Import failed");
    } finally {
      setPlexImporting(false);
    }
  };

  const handleScan = async (libraryId: number) => {
    setScanning(libraryId);
    try {
      await api.scanLibrary(libraryId);
      loadSettings();
    } catch (err) {
      console.error(err);
    } finally {
      setScanning(null);
    }
  };

  const handleSavePassword = async () => {
    setSavingPassword(true);
    setPasswordMessage(null);

    if (password !== confirmPassword) {
      setPasswordMessage("Passwords do not match");
      setSavingPassword(false);
      return;
    }

    try {
      const result = await api.updatePassword({
        password,
        currentPassword: settings?.passwordConfigured ? currentPassword : undefined,
      });
      setPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      setPasswordMessage(
        result.passwordConfigured
          ? "Password saved. You'll need it to access MEDIA!."
          : "Password removed.",
      );
      await refreshAuth();
      loadSettings();
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : "Failed to save password");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRemovePassword = async () => {
    setSavingPassword(true);
    setPasswordMessage(null);
    try {
      await api.updatePassword({
        currentPassword,
        remove: true,
      });
      setCurrentPassword("");
      setPasswordMessage("Password removed.");
      await refreshAuth();
      loadSettings();
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : "Failed to remove password");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  const initialLoad = loading && !settings;

  return (
    <div className="space-y-4">
      <Card className="min-h-[10rem]">
        <CardContent className="p-4 sm:p-5">
          {initialLoad ? (
            <SettingsCardSkeleton lines={4} />
          ) : (
            <LibraryManager
              libraries={settings?.libraries ?? []}
              onChange={() => loadSettings()}
              scanning={scanning}
              onScan={handleScan}
            />
          )}
        </CardContent>
      </Card>

      <Card className="min-h-[8rem]">
        <CardContent className="p-4 sm:p-5">
          {initialLoad ? (
            <SettingsCardSkeleton lines={3} />
          ) : (
            <DeckManager
              libraries={settings?.libraries ?? []}
              decks={settings?.decks ?? []}
              onChange={() => loadSettings()}
            />
          )}
        </CardContent>
      </Card>

      <SettingsSection
        icon={History}
        title="Import from Plex"
        description="Detect a local Plex Media Server library database and copy resume points and watched state into MEDIA!."
      >
        {initialLoad ? (
          <SettingsCardSkeleton lines={4} />
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              {plexPreview?.detected ? (
                <>
                  <p className="font-medium text-foreground">Plex library database detected</p>
                  <p className="mt-1 break-all font-mono text-xs">{plexPreview.dbPath}</p>
                </>
              ) : (
                <p>{plexPreview?.warning ?? "Scanning for Plex…"}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="plex-db-path">
                Plex database path
              </label>
              <Input
                id="plex-db-path"
                value={plexPath}
                onChange={(e) => setPlexPath(e.target.value)}
                placeholder="Optional (auto-detect when empty)"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Usually{" "}
                <span className="font-mono">
                  …/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db
                </span>
                . Stop Plex before importing.
              </p>
            </div>

            {plexLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking Plex database…
              </div>
            ) : plexPreview?.detected ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <StatusRow
                  label="Plex entries"
                  ok
                  okText={`${plexPreview.plexEntries} with play history`}
                  failText=""
                />
                <StatusRow
                  label="Can import"
                  ok={plexPreview.matchableEntries > 0}
                  okText={`${plexPreview.matchableEntries} matched in MEDIA!`}
                  failText="No matching files yet. Scan libraries first"
                />
                <StatusRow
                  label="Resume points"
                  ok={plexPreview.resumeEntries > 0}
                  okText={`${plexPreview.resumeEntries} in Plex`}
                  failText="None found"
                />
                <StatusRow
                  label="MEDIA! library"
                  ok={plexPreview.reelMovieFiles + plexPreview.reelEpisodes > 0}
                  okText={`${plexPreview.reelMovieFiles} movies / ${plexPreview.reelEpisodes} episodes`}
                  failText="No scanned media yet"
                />
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={plexOverwrite}
                onChange={(e) => setPlexOverwrite(e.target.checked)}
                className="rounded border-border"
              />
              Overwrite existing MEDIA! progress when Plex is newer or further along
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={plexLoading}
                onClick={() => void loadPlexPreview(plexPath.trim() || undefined)}
              >
                {plexLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Refresh detection"
                )}
              </Button>
              <Button
                type="button"
                disabled={
                  plexImporting ||
                  plexLoading ||
                  !plexPreview?.detected ||
                  plexPreview.matchableEntries === 0
                }
                onClick={() => void handleImportPlex()}
              >
                {plexImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  "Import watch history"
                )}
              </Button>
            </div>

            {plexPreview?.warning && plexPreview.detected && (
              <p className="text-xs text-muted-foreground">{plexPreview.warning}</p>
            )}

            {plexMessage && (
              <p className="text-sm text-muted-foreground">{plexMessage}</p>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        icon={Lock}
        title="Password"
        description="Protect MEDIA! with a password. When enabled, all pages and API routes require sign-in."
      >
          {initialLoad ? (
            <SettingsCardSkeleton lines={4} />
          ) : (
            <>
            {settings?.passwordConfigured ? (
              <p className="mb-3 text-sm text-muted-foreground">
                Status:{" "}
                <span className="font-medium text-accent">Enabled</span>
              </p>
            ) : (
              <p className="mb-3 text-sm text-muted-foreground">
                No password set. Open to anyone on this network.
              </p>
            )}

            {settings?.passwordConfigured && (
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="mb-2"
                autoComplete="current-password"
              />
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={settings?.passwordConfigured ? "New password" : "Password"}
                autoComplete="new-password"
              />
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={handleSavePassword}
                disabled={
                  savingPassword ||
                  !password.trim() ||
                  !confirmPassword.trim() ||
                  (settings?.passwordConfigured && !currentPassword.trim())
                }
              >
                {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {settings?.passwordConfigured ? "Change password" : "Set password"}
              </Button>

              {settings?.passwordConfigured && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemovePassword}
                    disabled={savingPassword || !currentPassword.trim()}
                  >
                    Remove password
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </Button>
                </>
              )}
            </div>

            {passwordMessage && (
              <p className="mt-2 text-sm text-muted-foreground">{passwordMessage}</p>
            )}
            </>
          )}
      </SettingsSection>

        {!initialLoad && settings && (
          <>
            <ApiKeysSettings settings={settings} onChange={() => loadSettings()} />

            <SettingsSection
              icon={Subtitles}
              title="Subtitle appearance"
              description="Customize how subtitles look during playback. Changes apply on this device."
            >
              <SubtitleAppearanceSettings />
            </SettingsSection>

            <UpdateManager />

            <SettingsSection icon={Database} title="System status">
              <div className="space-y-1">
                <StatusRow
                  label="FFmpeg"
                  ok={settings?.ffmpegAvailable ?? false}
                  okText="Available"
                  failText="Not found. Install ffmpeg"
                />
                <StatusRow
                  label="TMDB API"
                  ok={settings?.metadata.tmdbConfigured ?? false}
                  okText="Configured"
                  failText="Not configured"
                />
                <StatusRow
                  label="Fanart.tv"
                  ok={settings?.metadata.fanartConfigured ?? false}
                  okText="Configured"
                  failText="Not configured"
                />
                <StatusRow
                  label="OpenSubtitles"
                  ok={settings?.subtitles.opensubtitlesConfigured ?? false}
                  okText="Configured"
                  failText="Not configured"
                />
              </div>
            </SettingsSection>
          </>
        )}
    </div>
  );
}

function SettingsCardSkeleton({ lines }: { lines: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-40" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

function StatusRow({
  label,
  ok,
  okText,
  failText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-l border-border/80 py-1.5 pl-3">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-red-400" />
      )}
      <div className="min-w-0 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground"> · {ok ? okText : failText}</span>
      </div>
    </div>
  );
}
