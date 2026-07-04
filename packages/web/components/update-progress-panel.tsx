"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { UpdateProgress } from "@/lib/api";
import { formatElapsed } from "@/lib/update-utils";
import { cn } from "@/lib/utils";

function useLiveElapsed(startedAt: string | null, fallbackMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return fallbackMs;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return fallbackMs;
  return Math.max(0, now - startedMs);
}

interface UpdateProgressPanelProps {
  progress: UpdateProgress;
  className?: string;
}

export function UpdateProgressPanel({ progress, className }: UpdateProgressPanelProps) {
  const failed = progress.phase === "failed";
  const elapsedMs = useLiveElapsed(progress.startedAt, progress.elapsedMs);

  return (
    <div
      className={cn(
        "rounded-md border px-4 py-4 text-sm",
        failed
          ? "border-red-400/35 bg-red-400/10"
          : "border-primary/30 bg-primary/10",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-2 font-medium",
              failed ? "text-red-300" : "text-primary",
            )}
          >
            {!failed && progress.phase !== "complete" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : failed ? (
              <XCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            {failed ? "Update failed" : "Update in progress"}
          </div>
          <p className="mt-1 text-muted-foreground">{progress.message}</p>
          {progress.releaseTag ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Installing {progress.releaseTag}
              {progress.startedAt ? ` · running for ${formatElapsed(elapsedMs)}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {progress.steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-sm">
            {step.status === "complete" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
            ) : step.status === "active" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : step.status === "failed" ? (
              <XCircle className="h-4 w-4 shrink-0 text-red-400" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            )}
            <span
              className={cn(
                step.status === "active" && "font-medium text-foreground",
                step.status === "complete" && "text-muted-foreground",
                step.status === "pending" && "text-muted-foreground/70",
                step.status === "failed" && "font-medium text-red-300",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      {progress.phase === "restarting" ? (
        <p className="mt-4 text-xs text-muted-foreground">
          MEDIA! is restarting now. This page will reconnect automatically when the server
          is back, usually within a minute.
        </p>
      ) : progress.phase !== "failed" && progress.phase !== "complete" ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Keep this tab open. The app may briefly disconnect during the restart step.
        </p>
      ) : null}

      {progress.logTail.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Latest activity
          </p>
          <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md bg-background/60 p-3 font-mono text-[0.68rem] leading-relaxed text-muted-foreground">
            {progress.logTail.join("\n")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
