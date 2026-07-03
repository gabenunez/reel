"use client";

import { useState } from "react";
import {
  Film,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Tv,
  AlertTriangle,
} from "lucide-react";
import { api, type SettingsLibrary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderPicker } from "@/components/folder-picker";
import { cn } from "@/lib/utils";

interface LibraryManagerProps {
  libraries: SettingsLibrary[];
  onChange: () => void;
  scanning: number | null;
  onScan: (id: number) => void;
}

export function LibraryManager({
  libraries,
  onChange,
  scanning,
  onScan,
}: LibraryManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SettingsLibrary | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"movies" | "tv">("movies");
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const resetForm = () => {
    setShowForm(false);
    setEditing(null);
    setName("");
    setType("movies");
    setPath("");
    setError(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (lib: SettingsLibrary) => {
    setEditing(lib);
    setShowForm(true);
    setName(lib.name);
    setType(lib.type);
    setPath(lib.path);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.updateLibrary(editing.id, { name, type, path });
      } else {
        await api.createLibrary({ name, type, path });
      }
      resetForm();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save library");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (lib: SettingsLibrary) => {
    if (
      !confirm(
        `Remove "${lib.name}"? Media in this library will be removed from Reel (your files stay on disk).`,
      )
    ) {
      return;
    }

    setDeleting(lib.id);
    try {
      await api.deleteLibrary(lib.id);
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete library");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Media Libraries</h2>
          <p className="text-sm text-muted-foreground">
            Add folders containing your movies and TV shows. Changes apply immediately.
          </p>
        </div>
        {!showForm && (
          <Button onClick={openCreate}>
            <FolderPlus className="h-4 w-4" />
            Add Library
          </Button>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h3 className="mb-4 font-medium">
            {editing ? "Edit Library" : "New Library"}
          </h3>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Movies"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Type</label>
              <div className="flex gap-2">
                {(["movies", "tv"] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={type === option ? "default" : "outline"}
                    size="sm"
                    onClick={() => setType(option)}
                  >
                    {option === "movies" ? (
                      <Film className="h-4 w-4" />
                    ) : (
                      <Tv className="h-4 w-4" />
                    )}
                    {option === "movies" ? "Movies" : "TV Shows"}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Folder path</label>
              <FolderPicker value={path} onChange={setPath} />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving || !name.trim() || !path.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editing ? "Save changes" : "Add & scan"}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {libraries.map((lib) => (
          <div
            key={lib.id}
            className={cn(
              "rounded-xl border border-border p-4",
              !lib.pathExists && "border-yellow-500/30 bg-yellow-500/5",
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {lib.type === "movies" ? (
                    <Film className="h-4 w-4 text-primary" />
                  ) : (
                    <Tv className="h-4 w-4 text-primary" />
                  )}
                  <p className="font-medium">{lib.name}</p>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{lib.path}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {lib.type === "movies" ? "Movies" : "TV Shows"} · {lib.itemCount ?? 0} items
                  {lib.lastScannedAt &&
                    ` · Last scanned ${new Date(lib.lastScannedAt).toLocaleString()}`}
                </p>
                {!lib.pathExists && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-yellow-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Folder not found — update the path
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={scanning === lib.id}
                  onClick={() => onScan(lib.id)}
                >
                  {scanning === lib.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Scan
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEdit(lib)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deleting === lib.id}
                  onClick={() => handleDelete(lib)}
                >
                  {deleting === lib.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        ))}

        {!libraries.length && !showForm && (
          <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <FolderPlus className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 font-medium">No libraries yet</p>
            <p className="mb-4 text-sm text-muted-foreground">
              Add a folder to start building your media library.
            </p>
            <Button onClick={openCreate}>Add your first library</Button>
          </div>
        )}
      </div>
    </div>
  );
}
