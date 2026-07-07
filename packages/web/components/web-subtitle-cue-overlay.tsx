"use client";

import { findActiveCueTexts, parseWebVttCues } from "@media-app/shared";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSubtitleStyles } from "@/components/subtitle-style-settings";
import { playbackSubtitleAppearance } from "@/lib/subtitle-styles";
import { cn } from "@/lib/utils";

export function WebSubtitleCueOverlay({
  videoRef,
  vtt,
  getPlaybackSeconds,
  streamEpoch = 0,
  hidden = false,
  className,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  vtt: string | null;
  getPlaybackSeconds: () => number;
  /** Increment when the playback source restarts (seek/HLS generation). */
  streamEpoch?: number;
  /** Hide while watch menus or dialogs cover the lower chrome. */
  hidden?: boolean;
  className?: string;
}) {
  const { styles } = useSubtitleStyles();
  const [lines, setLines] = useState<string[]>([]);
  const [playbackReady, setPlaybackReady] = useState(false);
  const cues = useMemo(() => (vtt ? parseWebVttCues(vtt) : []), [vtt]);
  const getPlaybackSecondsRef = useRef(getPlaybackSeconds);
  getPlaybackSecondsRef.current = getPlaybackSeconds;

  useEffect(() => {
    setPlaybackReady(false);
  }, [streamEpoch]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlaying = () => setPlaybackReady(true);
    const onEmptied = () => setPlaybackReady(false);

    video.addEventListener("playing", onPlaying);
    video.addEventListener("emptied", onEmptied);

    if (!video.paused && !video.ended && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setPlaybackReady(true);
    }

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("emptied", onEmptied);
    };
  }, [videoRef, streamEpoch]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || cues.length === 0) {
      setLines([]);
      return;
    }

    const update = () => {
      if (!playbackReady) {
        setLines([]);
        return;
      }
      setLines(findActiveCueTexts(cues, getPlaybackSecondsRef.current()));
    };

    video.addEventListener("timeupdate", update);
    video.addEventListener("seeking", update);
    video.addEventListener("seeked", update);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("play", update);
    update();

    return () => {
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("seeking", update);
      video.removeEventListener("seeked", update);
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("play", update);
    };
  }, [videoRef, cues, playbackReady, getPlaybackSeconds]);

  if (hidden || !playbackReady || lines.length === 0) return null;

  const appearance = playbackSubtitleAppearance(styles);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-20 z-[15] flex justify-center px-6 sm:bottom-24 sm:px-10",
        className,
      )}
      role="region"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Subtitles"
    >
      <div
        className="max-w-4xl text-center text-balance whitespace-pre-wrap"
        style={{
          color: appearance.color,
          backgroundColor: appearance.backgroundColor,
          fontSize: appearance.fontSize,
          fontFamily: appearance.fontFamily,
          textShadow: appearance.textShadow,
          lineHeight: 1.35,
          padding: appearance.backgroundColor === "transparent" ? undefined : "0.2em 0.45em",
          borderRadius: appearance.backgroundColor === "transparent" ? undefined : "0.2em",
        }}
      >
        {lines.join("\n")}
      </div>
    </div>
  );
}
