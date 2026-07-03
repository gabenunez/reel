let castFrameworkLoaded = false;
let castFrameworkLoading: Promise<void> | null = null;

function initializeCastContext(): void {
  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  castFrameworkLoaded = true;
}

export function loadCastFramework(): Promise<void> {
  if (castFrameworkLoaded && window.cast?.framework) {
    return Promise.resolve();
  }

  if (castFrameworkLoading) {
    return castFrameworkLoading;
  }

  castFrameworkLoading = new Promise((resolve, reject) => {
    const finishInit = () => {
      try {
        initializeCastContext();
        resolve();
      } catch (err) {
        reject(
          err instanceof Error ? err : new Error("Failed to initialize Cast"),
        );
      }
    };

    if (window.cast?.framework) {
      finishInit();
      return;
    }

    window.__onGCastApiAvailable = (isAvailable) => {
      if (!isAvailable) {
        reject(new Error("Google Cast is not available in this browser"));
        return;
      }
      finishInit();
    };

    const existing = document.querySelector('script[src*="cast_sender.js"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src =
        "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
      script.async = true;
      script.onerror = () =>
        reject(new Error("Failed to load Google Cast SDK"));
      document.head.appendChild(script);
    }
  });

  return castFrameworkLoading;
}

export function isCastSupported(): boolean {
  return typeof window !== "undefined" && !/CrKey/i.test(navigator.userAgent);
}

export interface CastMediaOptions {
  contentUrl: string;
  contentType: string;
  title: string;
  posterUrl?: string | null;
  subtitleUrl?: string | null;
  subtitleLanguage?: string;
  startTime?: number;
}

function formatCastError(err: unknown): Error {
  if (err && typeof err === "object") {
    const castErr = err as { description?: string; code?: string | number };
    if (castErr.description) {
      return new Error(castErr.description);
    }
    if (castErr.code !== undefined) {
      return new Error(`Cast failed (code ${castErr.code})`);
    }
  }
  return err instanceof Error ? err : new Error("Cast failed to load media");
}

export async function castMedia(options: CastMediaOptions): Promise<void> {
  await loadCastFramework();

  const context = cast.framework.CastContext.getInstance();
  let session = context.getCurrentSession();

  if (!session) {
    await context.requestSession();
    session = context.getCurrentSession();
  }

  if (!session) {
    throw new Error("Could not connect to a Cast device");
  }

  const mediaInfo = new chrome.cast.media.MediaInfo(
    options.contentUrl,
    options.contentType,
  );
  mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
  mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
  mediaInfo.metadata.title = options.title;

  if (options.posterUrl) {
    mediaInfo.metadata.images = [{ url: options.posterUrl }];
  }

  if (options.subtitleUrl) {
    mediaInfo.tracks = [
      {
        trackId: 1,
        type: chrome.cast.media.TrackType.TEXT,
        trackContentId: options.subtitleUrl,
        trackContentType: "text/vtt",
        subtype: chrome.cast.media.TextTrackType.SUBTITLES,
        name: options.subtitleLanguage ?? "Subtitles",
        language: "en",
      },
    ];
    mediaInfo.textTrackStyle = new chrome.cast.media.TextTrackStyle();
    mediaInfo.activeTrackIds = [1];
  }

  const request = new chrome.cast.media.LoadMediaRequest(mediaInfo);
  if (options.startTime && options.startTime > 0) {
    request.currentTime = options.startTime;
  }

  return new Promise((resolve, reject) => {
    session.loadMedia(
      request,
      () => resolve(),
      (err: unknown) => reject(formatCastError(err)),
    );
  });
}

export function subscribeToCastState(
  onChange: (connected: boolean) => void,
): () => void {
  if (!window.cast?.framework) {
    return () => {};
  }

  const context = cast.framework.CastContext.getInstance();
  const handler = () => {
    const state = context.getCastState();
    onChange(state === cast.framework.CastState.CONNECTED);
  };

  context.addEventListener(
    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
    handler,
  );

  handler();

  return () => {
    context.removeEventListener(
      cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      handler,
    );
  };
}
