"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SubtitleTrack } from "@/lib/watch-helpers";
import {
  attachCachedWebSubtitle,
  clearSubtitleVttCache,
  clearWebSubtitleTracksFromVideo,
  evictSubtitleVttCache,
  installWebSubtitleVideoListeners,
  prefetchSubtitleTracks,
  prefetchSubtitleVtt,
  subscribeWebPlaybackSourceReady,
  syncWebSubtitleTrack,
} from "@/lib/web-subtitle-attach";

export function useSubtitleTracks(
  fileId: number,
  type: "movie" | "episode",
  videoRef: React.RefObject<HTMLVideoElement | null>,
  streamGeneration: number,
  timelineOffsetSeconds = 0,
) {
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null);
  const [opensubtitlesConfigured, setOpensubtitlesConfigured] = useState(false);
  const subtitlesRef = useRef(subtitles);
  const activeSubtitleRef = useRef(activeSubtitle);
  const timelineOffsetRef = useRef(timelineOffsetSeconds);
  const syncRef = useRef<(() => void) | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  subtitlesRef.current = subtitles;
  activeSubtitleRef.current = activeSubtitle;
  timelineOffsetRef.current = timelineOffsetSeconds;

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
        prefetchSubtitleTracks(tracks.map((track) => track.id));
      } catch (err) {
        console.warn("Failed to load subtitles", err);
      }
    },
    [fileId, type],
  );

  const prefetchMenuTracks = useCallback(() => {
    prefetchSubtitleTracks(subtitlesRef.current.map((track) => track.id));
    const activeId = activeSubtitleRef.current;
    if (activeId != null) {
      void prefetchSubtitleVtt(activeId);
    }
  }, []);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const selectSubtitle = useCallback(
    (subtitleId: number | null) => {
      if (subtitleId != null) {
        void prefetchSubtitleVtt(subtitleId);
        const video = videoRef.current;
        const activeTrack = subtitlesRef.current.find((track) => track.id === subtitleId);
        if (video) {
          revokeObjectUrl();
          objectUrlRef.current = attachCachedWebSubtitle(
            video,
            subtitleId,
            activeTrack?.language ?? "Subtitles",
            timelineOffsetRef.current,
          );
        }
      } else {
        const video = videoRef.current;
        if (video) clearWebSubtitleTracksFromVideo(video);
        revokeObjectUrl();
      }
      setActiveSubtitle(subtitleId);
      queueMicrotask(() => syncRef.current?.());
    },
    [revokeObjectUrl, videoRef],
  );

  useEffect(() => {
    clearSubtitleVttCache();
    setActiveSubtitle(null);
    setSubtitles([]);
    revokeObjectUrl();
  }, [fileId, type, revokeObjectUrl]);

  useEffect(() => {
    refreshSubtitles();
  }, [refreshSubtitles]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const controller = new AbortController();

    const sync = () => {
      const subtitleId = activeSubtitleRef.current;
      const activeTrack = subtitlesRef.current.find((track) => track.id === subtitleId);
      revokeObjectUrl();
      void syncWebSubtitleTrack(
        video,
        subtitleId,
        activeTrack?.language ?? "Subtitles",
        controller.signal,
        timelineOffsetRef.current,
      ).then((nextUrl) => {
        if (!controller.signal.aborted) {
          objectUrlRef.current = nextUrl;
        } else if (nextUrl) {
          URL.revokeObjectURL(nextUrl);
        }
      });
    };

    syncRef.current = sync;
    sync();

    const removeVideoListeners = installWebSubtitleVideoListeners(video, sync);
    const removePlaybackListener = subscribeWebPlaybackSourceReady(sync);

    return () => {
      syncRef.current = null;
      controller.abort();
      removeVideoListeners();
      removePlaybackListener();
    };
  }, [activeSubtitle, streamGeneration, timelineOffsetSeconds, videoRef, revokeObjectUrl]);

  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) clearWebSubtitleTracksFromVideo(video);
      revokeObjectUrl();
    };
  }, [videoRef, fileId, type, revokeObjectUrl]);

  const removeSubtitleTrack = useCallback(
    async (subtitleId: number) => {
      await api.deleteSubtitle(subtitleId);
      evictSubtitleVttCache(subtitleId);
      if (activeSubtitleRef.current === subtitleId) {
        selectSubtitle(null);
      }
      await refreshSubtitles();
    },
    [refreshSubtitles, selectSubtitle],
  );

  return {
    subtitles,
    activeSubtitle,
    setActiveSubtitle: selectSubtitle,
    selectSubtitle,
    prefetchMenuTracks,
    refreshSubtitles,
    removeSubtitleTrack,
    opensubtitlesConfigured,
  };
}
