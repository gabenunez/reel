import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MediaClient } from "../client";
import { fetchMediaDetail, fetchMediaIds } from "@/lib/server-api";

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  const ids = await fetchMediaIds();
  if (ids.length > 0) {
    console.log(`[media] Pre-rendering ${ids.length} page(s) at build time`);
  }
  return ids.map((id) => ({ id: String(id) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const mediaId = parseInt(id, 10);
  if (!Number.isFinite(mediaId)) return {};
  const { media } = await fetchMediaDetail(mediaId);
  const title = typeof media?.title === "string" ? media.title : undefined;
  return title ? { title } : {};
}

export default async function MediaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mediaId = parseInt(id, 10);
  if (!Number.isFinite(mediaId) || mediaId <= 0) notFound();

  const { media: initialMedia, unauthorized } = await fetchMediaDetail(mediaId);
  if (!initialMedia && !unauthorized) notFound();

  return (
    <MediaClient mediaId={mediaId} initialMedia={initialMedia ?? undefined} />
  );
}
