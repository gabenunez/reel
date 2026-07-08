"use client";

import { useEffect, useState } from "react";
import { api, type MediaItem } from "@/lib/api";
import { peekApiCache } from "@/lib/api-cache";

export function prefetchMediaPage(mediaId: number): void {
  if (!Number.isFinite(mediaId)) return;
  void api.getMedia(mediaId);
}

function readCachedMedia(mediaId: number | null) {
  if (mediaId == null) return null;
  return peekApiCache<Record<string, unknown>>(`media:${mediaId}`) ?? null;
}

function readSeed(
  mediaId: number | null,
  initialMedia?: Record<string, unknown> | null,
) {
  return initialMedia ?? readCachedMedia(mediaId);
}

export function useMediaPageData(
  mediaId: number,
  initialMedia?: Record<string, unknown> | null,
) {
  const validId = Number.isFinite(mediaId) ? mediaId : null;
  const seed = readSeed(validId, initialMedia);

  const [snapshot, setSnapshot] = useState(() => ({
    mediaId: validId,
    media: seed,
    related: [] as MediaItem[],
  }));

  useEffect(() => {
    if (validId == null) return;

    setSnapshot((prev) => {
      if (prev.mediaId === validId) return prev;
      const nextSeed = readSeed(validId, initialMedia);
      return {
        mediaId: validId,
        media: nextSeed,
        related: [],
      };
    });
  }, [validId, initialMedia]);

  useEffect(() => {
    if (validId == null) return;

    let cancelled = false;
    const hadSeed = Boolean(readSeed(validId, initialMedia));

    void api
      .getMedia(validId)
      .then((data) => {
        if (cancelled) return;
        setSnapshot((prev) =>
          prev.mediaId === validId ? { ...prev, media: data } : prev,
        );
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled && !hadSeed) {
          setSnapshot((prev) =>
            prev.mediaId === validId ? { ...prev, media: null } : prev,
          );
        }
      });

    void api
      .getRelatedMedia(validId)
      .then((data) => {
        if (!cancelled) {
          setSnapshot((prev) =>
            prev.mediaId === validId
              ? { ...prev, related: data.items }
              : prev,
          );
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [validId, initialMedia]);

  const media =
    snapshot.mediaId === validId
      ? snapshot.media ?? initialMedia ?? readCachedMedia(validId)
      : readSeed(validId, initialMedia);

  const related = snapshot.mediaId === validId ? snapshot.related : [];

  return {
    media,
    related,
    loading: false,
  };
}
