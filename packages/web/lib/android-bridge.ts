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

export type NativeVideoDisplayMode = "fit" | "fill" | "stretch";

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

export function androidTvShellSupportsLogout(): boolean {
  return typeof getAndroidBridge()?.logout === "function";
}

export function toAbsoluteMediaUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export function prepareNativeVideoOverlay(): void {
  getAndroidBridge()?.prepareNativeVideo?.();
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

export function setNativeVideoDisplayMode(mode: NativeVideoDisplayMode): void {
  getAndroidBridge()?.setVideoDisplayMode?.(mode);
}

/** Re-sync play/pause UI after the WebView resumes from background. */
export function syncNativePlaybackState(): void {
  getAndroidBridge()?.syncPlaybackState?.();
}

/** Hide the WebView layer during native playback so it does not dim ExoPlayer below. */
export function setNativeWebOverlayAlpha(alpha: number): void {
  getAndroidBridge()?.setWebOverlayAlpha?.(alpha);
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

/** TV shell calls this before default WebView/history back navigation. */
export function registerWatchBackHandler(handler: (() => boolean) | undefined): () => void {
  if (typeof window === "undefined") return () => {};
  window.__mediaWatchHandleBack = handler;
  return () => {
    delete window.__mediaWatchHandleBack;
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
      prepareNativeVideo?: () => void;
      play: (payload: string) => void;
      pause: () => void;
      resume: () => void;
      seekTo: (positionMs: number) => void;
      stop: () => void;
      setVideoDisplayMode?: (mode: NativeVideoDisplayMode) => void;
      syncPlaybackState?: () => void;
      setWebOverlayAlpha?: (alpha: number) => void;
    };
    /** Legacy Android TV shell before MEDIA! rebrand. */
    ReelAndroid?: Window["MediaAndroid"];
    /** Legacy callback target for older TV APKs. */
    __reelNativePlayer?: NativePlayerBridge;
    __mediaNativePlayer?: NativePlayerBridge;
    /** Watch view back handler for Android TV remote. Return true when consumed. */
    __mediaWatchHandleBack?: () => boolean;
  }
}

export {};
