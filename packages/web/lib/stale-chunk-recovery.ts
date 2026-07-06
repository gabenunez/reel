export const STALE_CHUNK_RELOAD_KEY = "media-stale-chunk-reload";

export function isStaleChunkMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("chunkloaderror") ||
    normalized.includes("loading chunk") ||
    normalized.includes("failed to fetch dynamically imported module") ||
    normalized.includes("importing a module script failed") ||
    normalized.includes("dynamically imported module")
  );
}

export function reloadForFreshAssets(reason: string): boolean {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) return false;

  sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, reason);
  window.location.reload();
  return true;
}

export function clearStaleChunkReloadGuard(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
}

export function installStaleChunkRecovery(): void {
  if (typeof window === "undefined") return;

  const handleMessage = (message: string) => {
    if (!isStaleChunkMessage(message)) return;
    reloadForFreshAssets(message);
  };

  window.addEventListener("error", (event) => {
    handleMessage(String(event.message ?? event.error?.message ?? ""));
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    handleMessage(reason instanceof Error ? reason.message : String(reason ?? ""));
  });
}
