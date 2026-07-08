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
    pending: validId != null && !seed,
  }));

  useEffect(() => {
    if (validId == null) return;
    const nextSeed = readSeed(validId, initialMedia);
    setSnapshot({
      mediaId: validId,
      media: nextSeed,
      related: [],
      pending: !nextSeed,
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
        setSnapshot((prev) => ({ ...prev, media: data, pending: false }));
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setSnapshot((prev) => ({
            ...prev,
            media: hadSeed ? prev.media : null,
            pending: false,
          }));
        }
      });

    void api
      .getRelatedMedia(validId)
      .then((data) => {
        if (!cancelled) {
          setSnapshot((prev) => ({ ...prev, related: data.items }));
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [validId]);

  const media =
    snapshot.mediaId === validId ? snapshot.media ?? seed : seed;
  const related = snapshot.mediaId === validId ? snapshot.related : [];
  const loading = validId != null && !media && snapshot.pending;

  return {
    media,
    related,
    loading,
  };
}
