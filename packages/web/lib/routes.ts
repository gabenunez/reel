export const routes = {
  home: () => "/",
  search: () => "/search/",
  library: (id: number) => `/library/?id=${id}`,
  deck: (id: number) => `/library/?deck=${id}`,
  media: (id: number) => `/media/?id=${id}`,
  favorites: (type?: "movie" | "tv") =>
    type ? `/favorites/?type=${type}` : "/favorites/",
  continueWatching: () => "/continue/",
  recentlyAdded: () => "/recent/",
  browse: () => "/browse/",
  settings: () => "/settings/",
  watch: (
    type: "movie" | "episode",
    fileId: number,
    mediaId?: number,
    posterPath?: string | null,
  ) => {
    const params = new URLSearchParams({
      type,
      id: String(fileId),
    });
    if (mediaId) params.set("media", String(mediaId));
    if (posterPath) params.set("poster", posterPath);
    return `/watch/?${params.toString()}`;
  },
};
