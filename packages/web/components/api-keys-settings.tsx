"use client";

import { useState, type ReactNode } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { api, type AppSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings-shell";

type ApiKeysSettingsProps = {
  settings: AppSettings;
  onChange: () => void;
};

export function ApiKeysSettings({ settings, onChange }: ApiKeysSettingsProps) {
  const [tmdbKey, setTmdbKey] = useState("");
  const [fanartKey, setFanartKey] = useState("");
  const [osKey, setOsKey] = useState("");
  const [savingTmdb, setSavingTmdb] = useState(false);
  const [savingFanart, setSavingFanart] = useState(false);
  const [savingOs, setSavingOs] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [tmdbMessage, setTmdbMessage] = useState<string | null>(null);
  const [fanartMessage, setFanartMessage] = useState<string | null>(null);
  const [osMessage, setOsMessage] = useState<string | null>(null);

  const handleSaveTmdbKey = async () => {
    setSavingTmdb(true);
    setTmdbMessage(null);
    try {
      const result = await api.updateMetadata(tmdbKey);
      if (result.metadataRefresh?.updated) {
        setTmdbMessage(
          `Saved. Updated metadata for ${result.metadataRefresh.updated} title${result.metadataRefresh.updated === 1 ? "" : "s"}`,
        );
      } else if (result.tmdbConfigured) {
        setTmdbMessage("Saved. Run Scan on your libraries to fetch metadata");
      } else {
        setTmdbMessage("Key cleared");
      }
      setTmdbKey("");
      onChange();
    } catch (err) {
      setTmdbMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingTmdb(false);
    }
  };

  const handleRefreshMetadata = async () => {
    setRefreshingMetadata(true);
    setTmdbMessage(null);
    try {
      const result = await api.refreshMetadata();
      setTmdbMessage(
        result.updated > 0
          ? `Updated metadata for ${result.updated} title${result.updated === 1 ? "" : "s"}`
          : "No unmatched titles found to update",
      );
      onChange();
    } catch (err) {
      setTmdbMessage(err instanceof Error ? err.message : "Failed to refresh metadata");
    } finally {
      setRefreshingMetadata(false);
    }
  };

  const handleSaveFanartKey = async () => {
    setSavingFanart(true);
    setFanartMessage(null);
    try {
      const result = await api.updateFanartKey(fanartKey);
      setFanartMessage(
        result.fanartConfigured
          ? result.themesSynced
            ? `Saved. Checked themes in ${result.themesSynced} librar${result.themesSynced === 1 ? "y" : "ies"}`
            : "Saved"
          : "Key cleared",
      );
      setFanartKey("");
      onChange();
    } catch (err) {
      setFanartMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingFanart(false);
    }
  };

  const handleSaveOsKey = async () => {
    setSavingOs(true);
    setOsMessage(null);
    try {
      const result = await api.updateOpenSubtitlesKey(osKey);
      setOsMessage(result.opensubtitlesConfigured ? "Saved" : "Key cleared");
      setOsKey("");
      onChange();
    } catch (err) {
      setOsMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingOs(false);
    }
  };

  return (
    <SettingsSection
      icon={KeyRound}
      title="API keys"
      description="Connect external services for posters and descriptions, TV theme music, and online subtitle search. All keys are free."
    >
      <div className="divide-y divide-border/70">
        <ApiKeyRow
          title="TMDB"
          configured={settings.metadata.tmdbConfigured}
          keyPreview={settings.metadata.tmdbApiKeyPreview}
          description={
            <>
              Posters, descriptions, and cast for movies and TV. Get a key at{" "}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="text-primary transition-colors hover:text-accent"
              >
                themoviedb.org
              </a>
              .
            </>
          }
          value={tmdbKey}
          onChange={setTmdbKey}
          placeholder="Paste your TMDB API key"
          saving={savingTmdb}
          onSave={handleSaveTmdbKey}
          message={tmdbMessage}
          extra={
            settings.metadata.tmdbConfigured ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshMetadata}
                disabled={refreshingMetadata || savingTmdb}
              >
                {refreshingMetadata ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Refresh metadata
              </Button>
            ) : null
          }
        />

        <ApiKeyRow
          title="fanart.tv"
          configured={settings.metadata.fanartConfigured}
          keyPreview={settings.metadata.fanartApiKeyPreview}
          description={
            <>
              TV show theme music on detail pages. Movies use{" "}
              <a
                href="https://app.lizardbyte.dev/ThemerrDB"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary transition-colors hover:text-accent"
              >
                ThemerrDB
              </a>{" "}
              automatically. Local <code className="text-xs">theme.mp3</code> files still work
              without a key. Get a key at{" "}
              <a
                href="https://fanart.tv/get-an-api-key/"
                target="_blank"
                rel="noreferrer"
                className="text-primary transition-colors hover:text-accent"
              >
                fanart.tv
              </a>
              .
            </>
          }
          value={fanartKey}
          onChange={setFanartKey}
          placeholder="Paste your fanart.tv API key"
          saving={savingFanart}
          onSave={handleSaveFanartKey}
          message={fanartMessage}
        />

        <ApiKeyRow
          title="OpenSubtitles"
          configured={settings.subtitles.opensubtitlesConfigured}
          keyPreview={settings.subtitles.opensubtitlesApiKeyPreview}
          description={
            <>
              Search and download subtitles during playback. Create a free key under{" "}
              <a
                href="https://www.opensubtitles.com/en/consumers"
                target="_blank"
                rel="noreferrer"
                className="text-primary transition-colors hover:text-accent"
              >
                API consumers
              </a>{" "}
              on OpenSubtitles.
            </>
          }
          value={osKey}
          onChange={setOsKey}
          placeholder="Paste your OpenSubtitles API key"
          saving={savingOs}
          onSave={handleSaveOsKey}
          message={osMessage}
        />
      </div>
    </SettingsSection>
  );
}

function ApiKeyRow({
  title,
  configured,
  keyPreview,
  description,
  value,
  onChange,
  placeholder,
  saving,
  onSave,
  message,
  extra,
}: {
  title: string;
  configured: boolean;
  keyPreview?: string;
  description: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  saving: boolean;
  onSave: () => void;
  message: string | null;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span
          className={
            configured
              ? "rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
              : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          }
        >
          {configured ? "Configured" : "Not configured"}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>

      {configured && keyPreview && (
        <p className="text-sm text-muted-foreground">
          Current key:{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-accent">
            {keyPreview}
          </code>
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={`${title} API key`}
        />
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !value.trim()}
          className="shrink-0"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save key
        </Button>
      </div>

      {(message || extra) && (
        <div className="flex flex-wrap items-center gap-3">
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          {extra}
        </div>
      )}
    </div>
  );
}
