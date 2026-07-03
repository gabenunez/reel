declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: {
      framework: {
        CastContext: {
          getInstance(): CastContext;
        };
        CastContextEventType: {
          CAST_STATE_CHANGED: string;
          SESSION_STATE_CHANGED: string;
        };
        CastState: {
          NO_DEVICES_AVAILABLE: string;
          NOT_CONNECTED: string;
          CONNECTING: string;
          CONNECTED: string;
        };
        SessionState: {
          SESSION_STARTED: string;
          SESSION_ENDED: string;
        };
      };
    };
  }

  const cast: {
    framework: {
      CastContext: {
        getInstance(): CastContext;
      };
      CastContextEventType: {
        CAST_STATE_CHANGED: string;
        SESSION_STATE_CHANGED: string;
      };
      CastState: {
        NO_DEVICES_AVAILABLE: string;
        NOT_CONNECTED: string;
        CONNECTING: string;
        CONNECTED: string;
      };
      SessionState: {
        SESSION_STARTED: string;
        SESSION_ENDED: string;
      };
    };
  };
  const chrome: {
    cast: {
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (contentId: string, contentType: string) => CastMediaInfo;
        GenericMediaMetadata: new () => CastGenericMediaMetadata;
        LoadMediaRequest: new (mediaInfo: CastMediaInfo) => CastLoadMediaRequest;
        TextTrackStyle: new () => CastTextTrackStyle;
        StreamType: { BUFFERED: string };
        TrackType: { TEXT: string };
        TextTrackType: { SUBTITLES: string };
      };
      AutoJoinPolicy: { ORIGIN_SCOPED: string };
    };
  };

  namespace cast {
    namespace framework {
      class CastContext {
        static getInstance(): CastContext;
        setOptions(options: CastContextOptions): void;
        requestSession(): Promise<void>;
        getCurrentSession(): CastSession | null;
        addEventListener(
          type: string,
          handler: (event: CastStateEvent) => void,
        ): void;
        removeEventListener(
          type: string,
          handler: (event: CastStateEvent) => void,
        ): void;
        getCastState(): string;
      }

      const CastContextEventType: {
        CAST_STATE_CHANGED: string;
        SESSION_STATE_CHANGED: string;
      };

      const CastState: {
        NO_DEVICES_AVAILABLE: string;
        NOT_CONNECTED: string;
        CONNECTING: string;
        CONNECTED: string;
      };

      const SessionState: {
        SESSION_STARTED: string;
        SESSION_ENDED: string;
      };
    }
  }

  interface CastContextOptions {
    receiverApplicationId: string;
    autoJoinPolicy: string;
  }

  interface CastSession {
    loadMedia(
      request: CastLoadMediaRequest,
      onSuccess?: () => void,
      onError?: (error: Error) => void,
    ): void;
  }

  interface CastMediaInfo {
    streamType: string;
    metadata: CastGenericMediaMetadata;
    tracks?: CastTrack[];
    textTrackStyle?: CastTextTrackStyle;
    activeTrackIds?: number[];
  }

  interface CastGenericMediaMetadata {
    title?: string;
    images?: Array<{ url: string }>;
  }

  interface CastLoadMediaRequest {
    currentTime?: number;
  }

  interface CastTrack {
    trackId: number;
    type: string;
    trackContentId: string;
    trackContentType: string;
    subtype: string;
    name: string;
    language: string;
  }

  interface CastTextTrackStyle {
    backgroundColor?: string;
    foregroundColor?: string;
  }

  interface CastStateEvent {
    castState?: string;
    sessionState?: string;
  }
}

export {};
