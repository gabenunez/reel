export const routes = {
  library: (id: number) => `/library/?id=${id}`,
  media: (id: number) => `/media/?id=${id}`,
  watch: (type: "movie" | "episode", fileId: number, mediaId?: number) => {
    const params = new URLSearchParams({
      type,
      id: String(fileId),
    });
    if (mediaId) params.set("media", String(mediaId));
    return `/watch/?${params.toString()}`;
  },
};
