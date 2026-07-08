"use client";

import { cn } from "@/lib/utils";
import { usePreloadedImage } from "@/lib/use-preloaded-image";
import { MediaImage } from "@/components/media-image";

interface PlaybackPosterBackdropProps {
  posterUrl: string | null;
  visible: boolean;
  /** Native ExoPlayer sits behind the WebView — avoid opaque letterbox fill. */
  transparentBackground?: boolean;
  className?: string;
}

export function PlaybackPosterBackdrop({
  posterUrl,
  visible,
  transparentBackground = false,
  className,
}: PlaybackPosterBackdropProps) {
  const ready = usePreloadedImage(visible ? posterUrl : null);

  if (!visible || !posterUrl) return null;

  return (
    <MediaImage
      src={posterUrl}
      alt=""
      fill
      priority
      sizes="100vw"
      className={cn(
        "pointer-events-none z-[1] object-contain transition-opacity duration-150",
        transparentBackground ? "bg-transparent" : "bg-black",
        ready ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
