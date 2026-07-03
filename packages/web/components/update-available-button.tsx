"use client";

import { ArrowUpCircle, Loader2 } from "lucide-react";
import { useUpdateStatus } from "@/components/update-status-provider";
import { Button } from "@/components/ui/button";

export function UpdateAvailableButton() {
  const { status, loading, openModal } = useUpdateStatus();

  if (loading || !status?.updateAvailable) {
    return null;
  }

  if (status.updateInProgress) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="border-primary/40 text-primary"
        onClick={openModal}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">Updating...</span>
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      className="shadow-[0_0_20px_hsl(var(--primary)/0.25)]"
      onClick={openModal}
    >
      <ArrowUpCircle className="h-4 w-4" />
      <span className="hidden sm:inline">Update available</span>
      <span className="sm:hidden">Update</span>
    </Button>
  );
}
