"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  Loader2,
  Lock,
  LogOut,
  XCircle,
  KeyRound,
  Music2,
  Subtitles,
} from "lucide-react";
import { api, type AppSettings } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LibraryManager } from "@/components/library-manager";
import { DeckManager } from "@/components/deck-manager";
import { UpdateManager } from "@/components/update-manager";
import { SettingsSection } from "@/components/settings-shell";
import { useDocumentTitle } from "@/lib/use-document-title";

export function SettingsClient() {
  useDocumentTitle("Settings");
  const { logout, refresh: refreshAuth } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<number | null>(null);
  const [tmdbKey, setTmdbKey] = useState("");
  const [fanartKey, setFanartKey] = useState("");
  const [osKey, setOsKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savingFanartKey, setSavingFanartKey] = useState(false);
  const [savingOsKey, setSavingOsKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [fanartKeyMessage, setFanartKeyMessage] = useState<string | null>(null);
  const [osKeyMessage, setOsKeyMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

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

  const handleSaveOsKey = async () => {
    setSavingOsKey(true);
    setOsKeyMessage(null);
    try {
      const result = await api.updateOpenSubtitlesKey(osKey);
      setOsKeyMessage(
        result.opensubtitlesConfigured
          ? "OpenSubtitles API key saved"
          : "Key cleared",
      );
      setOsKey("");
      loadSettings();
    } catch (err) {
      setOsKeyMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingOsKey(false);
    }
  };

  const handleSaveFanartKey = async () => {
    setSavingFanartKey(true);
    setFanartKeyMessage(null);
    try {
      const result = await api.updateFanartKey(fanartKey);
      setFanartKeyMessage(
        result.fanartConfigured
          ? result.themesSynced
            ? `Fanart API key saved — checked themes in ${result.themesSynced} librar${result.themesSynced === 1 ? "y" : "ies"}`
            : "Fanart API key saved"
          : "Key cleared",
      );
      setFanartKey("");
      loadSettings();
    } catch (err) {
      setFanartKeyMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingFanartKey(false);
    }
  };

  const handleSaveTmdbKey = async () => {
    setSavingKey(true);
    setKeyMessage(null);
    try {
      const result = await api.updateMetadata(tmdbKey);
      if (result.metadataRefresh?.updated) {
        setKeyMessage(
          `API key saved - updated metadata for ${result.metadataRefresh.updated} title${result.metadataRefresh.updated === 1 ? "" : "s"}`,
        );
      } else if (result.tmdbConfigured) {
        setKeyMessage("API key saved - run Scan on your libraries to fetch metadata");
      } else {
        setKeyMessage("Key saved - verify it works after scanning");
      }
      setTmdbKey("");
      loadSettings();
    } catch (err) {
      setKeyMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingKey(false);
    }
  };

  const handleRefreshMetadata = async () => {
    setSavingKey(true);
    setKeyMessage(null);
    try {
      const result = await api.refreshMetadata();
      setKeyMessage(
        result.updated > 0
          ? `Updated metadata for ${result.updated} title${result.updated === 1 ? "" : "s"}`
          : "No unmatched titles found to update",
      );
      loadSettings();
    } catch (err) {
      setKeyMessage(err instanceof Error ? err.message : "Failed to refresh metadata");
    } finally {
      setSavingKey(false);
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
          ? "Password saved. You'll need it to access Reel."
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
        icon={Lock}
        title="Password"
        description="Protect Reel with a password. When enabled, all pages and API routes require sign-in."
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
                No password set — open to anyone on this network.
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

        {!initialLoad && (
          <>
            <SettingsSection
              icon={KeyRound}
              title="TMDB Metadata"
              description={
                <>
                  Free API key from{" "}
                  <a
                    href="https://www.themoviedb.org/settings/api"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary transition-colors hover:text-accent"
                  >
                    themoviedb.org
                  </a>{" "}
                  for posters and descriptions.
                </>
              }
            >
              {settings?.metadata.tmdbConfigured && settings.metadata.tmdbApiKeyPreview && (
                <p className="mb-2 text-sm text-muted-foreground">
                  Current key:{" "}
                  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-accent">
                    {settings.metadata.tmdbApiKeyPreview}
                  </code>
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="password"
                  value={tmdbKey}
                  onChange={(e) => setTmdbKey(e.target.value)}
                  placeholder="Paste your TMDB API key"
                />
                <Button
                  size="sm"
                  onClick={handleSaveTmdbKey}
                  disabled={savingKey || !tmdbKey.trim()}
                  className="shrink-0"
                >
                  {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save key
                </Button>
              </div>
              {keyMessage && (
                <p className="mt-2 text-sm text-muted-foreground">{keyMessage}</p>
              )}

              {settings?.metadata.tmdbConfigured && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleRefreshMetadata}
                  disabled={savingKey}
                >
                  {savingKey ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Refresh metadata
                </Button>
              )}
            </SettingsSection>

            <SettingsSection
              icon={Music2}
              title="Theme music"
              description={
                <>
                  Free API key from{" "}
                  <a
                    href="https://fanart.tv/get-an-api-key/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary transition-colors hover:text-accent"
                  >
                    fanart.tv
                  </a>{" "}
                  fetches TV show themes for detail pages. Local <code className="text-xs">theme.mp3</code>{" "}
                  files in a show folder still work without a key.
                </>
              }
            >
              {settings?.metadata.fanartConfigured &&
                settings.metadata.fanartApiKeyPreview && (
                  <p className="mb-2 text-sm text-muted-foreground">
                    Current key:{" "}
                    <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-accent">
                      {settings.metadata.fanartApiKeyPreview}
                    </code>
                  </p>
                )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="password"
                  value={fanartKey}
                  onChange={(e) => setFanartKey(e.target.value)}
                  placeholder="Paste your fanart.tv API key"
                />
                <Button
                  size="sm"
                  onClick={handleSaveFanartKey}
                  disabled={savingFanartKey || !fanartKey.trim()}
                  className="shrink-0"
                >
                  {savingFanartKey ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save key
                </Button>
              </div>
              {fanartKeyMessage && (
                <p className="mt-2 text-sm text-muted-foreground">{fanartKeyMessage}</p>
              )}
            </SettingsSection>

            <SettingsSection
              icon={Subtitles}
              title="OpenSubtitles"
              description={
                <>
                  Create a free key under{" "}
                  <a
                    href="https://www.opensubtitles.com/en/consumers"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary transition-colors hover:text-accent"
                  >
                    API consumers
                  </a>{" "}
                  on OpenSubtitles, then paste it below.
                </>
              }
            >
              {settings?.subtitles.opensubtitlesConfigured &&
                settings.subtitles.opensubtitlesApiKeyPreview && (
                  <p className="mb-2 text-sm text-muted-foreground">
                    Current key:{" "}
                    <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-accent">
                      {settings.subtitles.opensubtitlesApiKeyPreview}
                    </code>
                  </p>
                )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="password"
                  value={osKey}
                  onChange={(e) => setOsKey(e.target.value)}
                  placeholder="Paste your OpenSubtitles API key"
                />
                <Button
                  size="sm"
                  onClick={handleSaveOsKey}
                  disabled={savingOsKey || !osKey.trim()}
                  className="shrink-0"
                >
                  {savingOsKey ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save key
                </Button>
              </div>
              {osKeyMessage && (
                <p className="mt-2 text-sm text-muted-foreground">{osKeyMessage}</p>
              )}
            </SettingsSection>

            <UpdateManager />

            <SettingsSection icon={Database} title="System status">
              <div className="space-y-1">
                <StatusRow
                  label="FFmpeg"
                  ok={settings?.ffmpegAvailable ?? false}
                  okText="Available"
                  failText="Not found — install ffmpeg"
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
        <span className="text-muted-foreground"> — {ok ? okText : failText}</span>
      </div>
    </div>
  );
}
