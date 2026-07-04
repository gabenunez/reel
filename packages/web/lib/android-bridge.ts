export interface NativePlaybackRequest {
  url: string;
  title: string;
  fileId: number;
  itemType: "movie" | "episode";
  startSeconds: number;
  durationMs: number;
  isHls: boolean;
  subtitleUrl?: string;
}

export interface NativePlaybackState {
  currentTime: number;
  duration: number;
  buffered: number;
  isPlaying: boolean;
  isBuffering: boolean;
  ready: boolean;
}

type AndroidBridge = NonNullable<Window["MediaAndroid"]>;

interface NativePlayerBridge {
  onState?: (state: NativePlaybackState) => void;
  onError?: () => void;
  onEnded?: () => void;
}

function getAndroidBridge(): AndroidBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.MediaAndroid ?? window.ReelAndroid;
}

export function nativeTvPlayerAvailable(): boolean {
  return typeof getAndroidBridge()?.play === "function";
}

export function toAbsoluteMediaUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export function startNativePlayback(request: NativePlaybackRequest): void {
  getAndroidBridge()?.play?.(JSON.stringify(request));
}

export function pauseNativePlayback(): void {
  getAndroidBridge()?.pause?.();
}

export function resumeNativePlayback(): void {
  getAndroidBridge()?.resume?.();
}

export function seekNativePlayback(positionMs: number): void {
  getAndroidBridge()?.seekTo?.(positionMs);
}

export function stopNativePlayback(): void {
  getAndroidBridge()?.stop?.();
}

export function registerNativePlayerHandlers(handlers: {
  onState?: (state: NativePlaybackState) => void;
  onError?: () => void;
  onEnded?: () => void;
}): () => void {
  const bridge: NativePlayerBridge = {
    onState: (state: NativePlaybackState) => handlers.onState?.(state),
    onError: () => handlers.onError?.(),
    onEnded: () => handlers.onEnded?.(),
  };

  window.__mediaNativePlayer = bridge;
  window.__reelNativePlayer = bridge;

  return () => {
    delete window.__mediaNativePlayer;
    delete window.__reelNativePlayer;
  };
}

export function notifyAndroidLogout() {
  if (typeof window === "undefined") return;
  getAndroidBridge()?.logout();
}

declare global {
  interface Window {
    MediaAndroid?: {
      logout: () => void;
      play: (payload: string) => void;
      pause: () => void;
      resume: () => void;
      seekTo: (positionMs: number) => void;
      stop: () => void;
    };
    /** Legacy Android TV shell before MEDIA! rebrand. */
    ReelAndroid?: Window["MediaAndroid"];
    /** Legacy callback target for older TV APKs. */
    __reelNativePlayer?: NativePlayerBridge;
    __mediaNativePlayer?: NativePlayerBridge;
  }
}

export {};
