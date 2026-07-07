export interface HlsSubtitleTimelineOptions {
  streamStartSeconds: number | null;
  hlsStartOffsetLive: number;
  hlsStartOffset: number;
  initialResumeSeconds: number | null;
  /** When true, ignore saved resume until stream offset state is live. */
  playbackActive?: boolean;
}

/** Absolute media time (seconds) that HLS `video.currentTime` 0 maps to. */
export function resolveHlsSubtitleTimelineOffset(
  options: HlsSubtitleTimelineOptions,
): number {
  const {
    streamStartSeconds,
    hlsStartOffsetLive,
    hlsStartOffset,
    initialResumeSeconds,
    playbackActive = false,
  } = options;

  if (streamStartSeconds != null) return streamStartSeconds;
  if (hlsStartOffsetLive > 0) return hlsStartOffsetLive;
  if (hlsStartOffset > 0) return hlsStartOffset;
  if (!playbackActive && initialResumeSeconds != null) {
    return initialResumeSeconds;
  }
  return 0;
}

export function resolveWebSubtitlePlaybackSeconds(options: {
  usingHlsPlayback: boolean;
  videoCurrentTime: number;
} & HlsSubtitleTimelineOptions): number {
  if (!options.usingHlsPlayback) return options.videoCurrentTime;

  const offset = resolveHlsSubtitleTimelineOffset(options);
  return offset + options.videoCurrentTime;
}
