import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MediaHeroServer } from "../media-hero-server";
import { MediaPageBody } from "../media-page-body";
import { MediaRelatedServer } from "../media-related-server";
import { MediaDocumentTitle, MediaThemeShell } from "../media-chrome";
import { MediaAuthRequired } from "../media-auth-required";
import { asMediaDetail } from "../types";
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

  const { media: raw, unauthorized } = await fetchMediaDetail(mediaId);
  if (!raw && !unauthorized) notFound();
  if (unauthorized) return <MediaAuthRequired />;
  if (!raw) return null;

  const media = asMediaDetail(raw);

  const page = (
    <>
      <MediaDocumentTitle title={media.title} />
      <div data-web-only>
        <MediaHeroServer media={media} />
      </div>
      <MediaPageBody media={media} />
      <Suspense fallback={null}>
        <MediaRelatedServer mediaId={mediaId} mediaType={media.type} />
      </Suspense>
    </>
  );

  if (media.hasThemeMusic) {
    return <MediaThemeShell mediaId={media.id}>{page}</MediaThemeShell>;
  }

  return page;
}
