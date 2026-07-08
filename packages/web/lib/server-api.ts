function internalApiBase(): string {
  if (process.env.MEDIA_INTERNAL_API_URL) {
    return process.env.MEDIA_INTERNAL_API_URL.replace(/\/$/, "");
  }
  const port = process.env.MEDIA_INTERNAL_API_PORT ?? "8097";
  return `http://127.0.0.1:${port}`;
}

async function internalApiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${internalApiBase()}${path}`, init);
}

export async function fetchMediaIds(): Promise<number[]> {
  try {
    const res = await internalApiFetch("/api/media/ids");
    if (!res.ok) return [];
    const data = (await res.json()) as { ids?: unknown };
    if (!Array.isArray(data.ids)) return [];
    return data.ids
      .map((id) => (typeof id === "number" ? id : parseInt(String(id), 10)))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
}

export async function fetchMediaDetail(
  mediaId: number,
  revalidateSeconds = 300,
): Promise<{
  media: Record<string, unknown> | null;
  unauthorized: boolean;
}> {
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return { media: null, unauthorized: false };
  }

  const res = await internalApiFetch(`/api/media/${mediaId}`, {
    next: { revalidate: revalidateSeconds },
  });

  if (res.status === 401) return { media: null, unauthorized: true };
  if (res.status === 404) return { media: null, unauthorized: false };
  if (!res.ok) {
    throw new Error(`Failed to fetch media ${mediaId}: ${res.status}`);
  }

  return {
    media: (await res.json()) as Record<string, unknown>,
    unauthorized: false,
  };
}
