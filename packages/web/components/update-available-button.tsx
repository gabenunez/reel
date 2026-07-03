"use client";

import { ArrowUpCircle, Loader2 } from "lucide-react";
import { useUpdateStatus } from "@/components/update-status-provider";
import { cn } from "@/lib/utils";

export function UpdateAvailableButton() {
  const { status, loading, openModal } = useUpdateStatus();

  if (loading || !status?.updateAvailable) {
    return null;
  }

  if (status.updateInProgress) {
    const label = status.updateProgress?.message ?? "Updating";
    return (
      <button
        type="button"
        onClick={openModal}
        className="flex h-9 max-w-[12rem] items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="truncate hidden sm:inline">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openModal}
      className={cn(
        "relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-all",
        "bg-primary text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.28)] hover:bg-primary/90",
      )}
    >
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.8)] sm:hidden" />
      <ArrowUpCircle className="h-4 w-4" />
      <span className="hidden sm:inline">Update</span>
    </button>
  );
}
