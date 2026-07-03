"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Home, HardDrive } from "lucide-react";
import { api, type BrowseResult, type BrowseShortcut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  onSelect?: (path: string) => void;
}

export function FolderPicker({ value, onChange, onSelect }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [shortcuts, setShortcuts] = useState<BrowseShortcut[]>([]);
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const loadBrowse = async (path?: string) => {
    setLoading(true);
    try {
      const [result, settings] = await Promise.all([
        api.browse((path ?? value) || undefined),
        shortcuts.length ? Promise.resolve(null) : api.getSettings(),
      ]);
      setBrowse(result);
      if (settings?.browseShortcuts) {
        setShortcuts(settings.browseShortcuts);
      }
    } catch {
      setValidation("Could not browse this location");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(async () => {
      const result = await api.validatePath(value).catch(() => null);
      setValidation(result?.valid ? null : result?.error ?? null);
    }, 400);
    return () => clearTimeout(timer);
  }, [value]);

  const openPicker = async () => {
    setOpen(true);
    await loadBrowse(value || undefined);
  };

  const navigate = async (path: string) => {
    onChange(path);
    await loadBrowse(path);
  };

  const selectCurrent = () => {
    if (browse?.current) {
      onChange(browse.current);
      onSelect?.(browse.current);
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/Users/you/Movies"
          className={cn(validation && "border-red-500/50")}
        />
        <Button type="button" variant="outline" onClick={openPicker}>
          <FolderOpen className="h-4 w-4" />
          Browse
        </Button>
      </div>
      {validation && (
        <p className="text-xs text-red-400">{validation}</p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-lg font-semibold">Choose a folder</h3>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {browse?.current ?? "Loading..."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
              {shortcuts.map((shortcut) => (
                <Button
                  key={shortcut.path}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(shortcut.path)}
                >
                  {shortcut.label === "Home" ? (
                    <Home className="h-3.5 w-3.5" />
                  ) : (
                    <HardDrive className="h-3.5 w-3.5" />
                  )}
                  {shortcut.label}
                </Button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {loading ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Loading folders...
                </p>
              ) : browse?.entries.length ? (
                browse.entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => navigate(entry.path)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary"
                  >
                    <Folder className="h-5 w-5 shrink-0 text-primary" />
                    <span className="truncate">{entry.name}</span>
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No subfolders here
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
              <Button
                type="button"
                variant="ghost"
                disabled={!browse?.parent}
                onClick={() => browse?.parent && navigate(browse.parent)}
              >
                Up
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={selectCurrent} disabled={!browse?.isDirectory}>
                  Select folder
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
