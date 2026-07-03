"use client";

import { useCallback, useEffect, useState } from "react";
import { Cast, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  castMedia,
  formatCastError,
  getCastContextHint,
  isCastBrowser,
  isCastSupported,
  loadCastFramework,
  subscribeToCastState,
} from "@/lib/cast";

interface CastButtonProps {
  disabled?: boolean;
  className?: string;
  onCast: () => Promise<{
    contentUrl: string;
    contentType: string;
    title: string;
    posterUrl?: string | null;
    subtitleUrl?: string | null;
    subtitleLanguage?: string;
    startTime?: number;
  }>;
}

export function CastButton({ disabled, className, onCast }: CastButtonProps) {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCastBrowser()) return;

    setAvailable(true);

    if (!isCastSupported()) return;

    let unsubscribe: (() => void) | undefined;

    loadCastFramework()
      .then(() => {
        unsubscribe = subscribeToCastState(setConnected);
      })
      .catch((err) => {
        setError(formatCastError(err).message);
      });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleCast = useCallback(async () => {
    setError(null);

    const contextHint = getCastContextHint();
    if (contextHint) {
      setError(contextHint);
      return;
    }

    setLoading(true);
    try {
      const media = await onCast();
      await castMedia(media);
    } catch (err) {
      setError(formatCastError(err).message);
    } finally {
      setLoading(false);
    }
  }, [onCast]);

  if (!available) return null;

  const contextHint = getCastContextHint();

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || loading}
        onClick={handleCast}
        title={
          contextHint ??
          (connected ? "Cast to connected device" : "Cast to TV")
        }
        className={className}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Cast className={`h-4 w-4 ${connected ? "text-primary" : ""}`} />
        )}
      </Button>
      {error && (
        <div className="absolute bottom-full right-0 mb-2 w-64 rounded-lg border border-border bg-card p-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
