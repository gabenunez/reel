import { MediaRow } from "@/components/media-row";
import { TvRow } from "@/components/tv/tv-row";
import { TvPoster } from "@/components/tv/tv-poster";
import { fetchRelatedMedia } from "@/lib/server-api";
import type { MediaItem } from "@/lib/api";

export async function MediaRelatedServer({
  mediaId,
  mediaType,
}: {
  mediaId: number;
  mediaType: "movie" | "tv";
}) {
  const items = (await fetchRelatedMedia(mediaId)) as unknown as MediaItem[];
  if (!items.length) return null;

  const title =
    mediaType === "movie"
      ? "More films in your library"
      : "More series in your library";

  return (
    <>
      <div data-web-only>
        <section className="border-t border-border/70 pb-12 pt-10">
          <MediaRow title={title} items={items} />
        </section>
      </div>
      <div data-tv-only className="mt-2">
        <TvRow title={title}>
          {items.map((item) => (
            <TvPoster key={item.id} item={item} />
          ))}
        </TvRow>
      </div>
    </>
  );
}
