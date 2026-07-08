import { MediaHero } from "./media-hero";
import type { MediaDetail } from "./types";

export function MediaHeroServer({ media }: { media: MediaDetail }) {
  return <MediaHero media={media} />;
}
