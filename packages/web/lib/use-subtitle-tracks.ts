"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SubtitleTrack } from "@/lib/watch-helpers";

export function useSubtitleTracks(
  fileId: number,
  type: "movie" | "episode",
  videoRef: React.RefObject<HTMLVideoElement | null>,
  streamGeneration: number,
) {
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null);
  const [opensubtitlesConfigured, setOpensubtitlesConfigured] = useState(false);

  const refreshSubtitles = useCallback(
    async (ensureTrack?: SubtitleTrack) => {
      if (!fileId || Number.isNaN(fileId)) return;
      try {
        const data = await api.listSubtitles(
          fileId,
          type === "movie" ? "movie" : "episode",
        );
        const tracks =
          ensureTrack && !data.tracks.some((track) => track.id === ensureTrack.id)
            ? [...data.tracks, ensureTrack]
            : data.tracks;
        setSubtitles(tracks);
        setActiveSubtitle((current) => {
          const keepId = current ?? ensureTrack?.id ?? null;
          if (keepId && tracks.some((track) => track.id === keepId)) {
            return keepId;
          }
          return null;
        });
        setOpensubtitlesConfigured(data.opensubtitlesConfigured);
      } catch (err) {
        console.warn("Failed to load subtitles", err);
      }
    },
    [fileId, type],
  );

  useEffect(() => {
    refreshSubtitles();
  }, [refreshSubtitles]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || activeSubtitle === null) {
      video?.querySelectorAll("track").forEach((track) => track.remove());
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const activeTrack = subtitles.find((sub) => sub.id === activeSubtitle);

    const clearTracks = () => {
      video.querySelectorAll("track").forEach((track) => track.remove());
    };

    clearTracks();

    void (async () => {
      try {
        const res = await fetch(api.subtitleUrl(activeSubtitle), {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;

        const vtt = await res.text();
        if (cancelled || !vtt.trim()) return;

        objectUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
        if (cancelled) return;

        const track = document.createElement("track");
        track.kind = "subtitles";
        track.src = objectUrl;
        track.default = true;
        track.label = activeTrack?.language ?? "Subtitles";
        track.srclang = activeTrack?.language?.slice(0, 2) ?? "en";
        track.addEventListener("load", () => {
          if (track.track) track.track.mode = "showing";
        });
        video.appendChild(track);
        if (track.track) track.track.mode = "showing";
      } catch (err) {
        console.warn("Failed to load subtitle track", err);
      }
    })();

    return () => {
      cancelled = true;
      clearTracks();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeSubtitle, subtitles, streamGeneration, videoRef]);

  return {
    subtitles,
    activeSubtitle,
    setActiveSubtitle,
    refreshSubtitles,
    opensubtitlesConfigured,
  };
}
