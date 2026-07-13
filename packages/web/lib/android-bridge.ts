import type { SubtitleStyles } from "@/lib/subtitle-styles";
import { withBasePath } from "@/lib/base-path";

export interface NativePlaybackRequest {
  url: string;
  title: string;
  fileId: number;
  itemType: "movie" | "episode";
  startSeconds: number;
  durationMs: number;
  isHls: boolean;
  subtitleUrl?: string;
  /** Server-reported HDR metadata — native player passes HDR through to the panel. */
  isHdr?: boolean;
  /** Source carries a Dolby Vision layer — keep DV output engaged natively. */
  dolbyVision?: boolean;
}

export interface NativePlaybackState {
  currentTime: number;
  duration: number;
  /** Highest buffered position in seconds (player timeline). */
  buffered: number;
  bufferedRanges?: Array<{ start: number; end: number }>;
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
  const prefixed = withBasePath(path.startsWith("/") ? path : `/${path}`);
  if (typeof window === "undefined") return prefixed;
  return new URL(prefixed, window.location.origin).toString();
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

/** Swap subtitle track without tearing down native playback. Returns false if unsupported. */
export function updateNativeSubtitles(subtitleUrl?: string): boolean {
  const bridge = getAndroidBridge();
  if (typeof bridge?.setSubtitles !== "function") return false;
  return bridge.setSubtitles(subtitleUrl ?? "") === true;
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

/** Native TV startup splash — dismiss once web UI is painted. */
export function notifyAndroidTvBootReady(): void {
  getAndroidBridge()?.notifyTvBootReady?.();
}

/** Apply user subtitle appearance settings to ExoPlayer's SubtitleView. */
export function setNativeSubtitleStyles(styles: SubtitleStyles): void {
  const bridge = getAndroidBridge();
  if (typeof bridge?.setSubtitleStyles !== "function") return;
  bridge.setSubtitleStyles(JSON.stringify(styles));
}

export function nativeSubtitleStylesAvailable(): boolean {
  return typeof getAndroidBridge()?.setSubtitleStyles === "function";
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
      setSubtitles?: (subtitleUrl: string) => boolean;
      setSubtitleStyles?: (json: string) => boolean;
      setVideoDisplayMode?: (mode: NativeVideoDisplayMode) => void;
      syncPlaybackState?: () => void;
      setWebOverlayAlpha?: (alpha: number) => void;
      notifyTvBootReady?: () => void;
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
