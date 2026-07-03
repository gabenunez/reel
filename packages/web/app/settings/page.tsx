"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  XCircle,
  KeyRound,
} from "lucide-react";
import { api, type AppSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LibraryManager } from "@/components/library-manager";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<number | null>(null);
  const [tmdbKey, setTmdbKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);

  const loadSettings = () => {
    setLoading(true);
    api
      .getSettings()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSettings();
    const interval = setInterval(loadSettings, 5000);
    return () => clearInterval(interval);
  }, []);

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

  const handleSaveTmdbKey = async () => {
    setSavingKey(true);
    setKeyMessage(null);
    try {
      const result = await api.updateMetadata(tmdbKey);
      setKeyMessage(result.tmdbConfigured ? "API key saved" : "Key saved — verify it works after scanning");
      setTmdbKey("");
      loadSettings();
    } catch (err) {
      setKeyMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingKey(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Skeleton className="mb-8 h-10 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-3xl font-bold">Settings</h1>
      <p className="mb-8 text-muted-foreground">
        Manage libraries, metadata, and server status — no config files required.
      </p>

      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <LibraryManager
              libraries={settings?.libraries ?? []}
              onChange={loadSettings}
              scanning={scanning}
              onScan={handleScan}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">TMDB Metadata</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Get a free API key from{" "}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                themoviedb.org
              </a>{" "}
              for posters, descriptions, and cast info.
            </p>

            {settings?.metadata.tmdbConfigured && settings.metadata.tmdbApiKeyPreview && (
              <p className="mb-3 text-sm text-muted-foreground">
                Current key:{" "}
                <code className="rounded bg-secondary px-1.5 py-0.5">
                  {settings.metadata.tmdbApiKeyPreview}
                </code>
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                type="password"
                value={tmdbKey}
                onChange={(e) => setTmdbKey(e.target.value)}
                placeholder="Paste your TMDB API key"
              />
              <Button
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">System Status</h2>
            <div className="space-y-3">
              <StatusRow
                label="FFmpeg"
                ok={settings?.ffmpegAvailable ?? false}
                okText="Available for transcoding"
                failText="Not found — install with: brew install ffmpeg"
              />
              <StatusRow
                label="TMDB API"
                ok={settings?.metadata.tmdbConfigured ?? false}
                okText="Configured"
                failText="Add your API key above for rich metadata"
              />
            </div>
          </CardContent>
        </Card>
      </div>
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
    <div className="flex items-center gap-3">
      {ok ? (
        <CheckCircle2 className="h-5 w-5 text-green-500" />
      ) : (
        <XCircle className="h-5 w-5 text-red-400" />
      )}
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{ok ? okText : failText}</p>
      </div>
    </div>
  );
}
