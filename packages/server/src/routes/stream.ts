import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import mime from "mime-types";
import type { AppConfig } from "@media-app/shared";
import { getAvailableQualities, isBrowserDirectPlayAudioSupported, isBrowserDirectPlayVideoSupported, isHlsVideoCopySupported, parseHlsQuality, parseTranscodeQuality, resolveNativeTvPlaybackMode, resolveOriginalPlaybackMode } from "@media-app/shared";
import type { DatabaseInstance } from "../db/index.js";
import type { SubtitleService } from "../services/subtitles.js";
import { subtitleHasContent } from "../utils/subtitle-content.js";
import { shiftVttByOffset } from "@media-app/shared";
import {
  mediaItems,
  movieFiles,
  tvEpisodes,
  tvSeasons,
  subtitles,
  watchProgress,
} from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import {
  startHlsTranscode,
  startHlsRemux,
  resolveHlsSession,
  generateHlsPlaylist,
  parseHlsSegmentIndex,
  isTranscodeInProgress,
  isTranscodeComplete,
  waitForFirstSegment,
  waitForHlsSegment,
  getHlsSession,
  stopTranscodeSessionsForFile,
  waitForPlaylist,
  probeFile,
  stopHlsSession,
} from "../utils/ffmpeg.js";
import {
  ensureThumbnailSprite,
  getCachedThumbnailPaths,
  isThumbnailGenerationPending,
  thumbnailCacheDir,
} from "../utils/thumbnails.js";
import { createStreamSessionId } from "../utils/stream-session.js";
import { getCastBaseUrl, toAbsoluteUrl } from "../utils/network.js";
import {
  matchConditionalGet,
  setStrongEtag,
  strongEtagForSize,
  strongEtagForString,
} from "../utils/http-cache.js";

interface StreamParams {
  fileId: string;
}

interface StreamQuery {
  type?: "movie" | "episode";
  transcode?: string;
  quality?: string;
  cast?: string;
  base?: string;
  start?: string;
  castToken?: string;
}

interface StreamStopBody {
  type?: "movie" | "episode";
}

type StreamFile = {
  filePath: string;
  id: number;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
};

const STREAM_READ_HIGH_WATER_MARK = 2 * 1024 * 1024;

function parseStartSeconds(value?: string): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseRangeNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseHttpRange(
  range: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!range?.startsWith("bytes=") || size <= 0) return null;

  const spec = range.slice("bytes=".length).split(",")[0]?.trim();
  if (!spec) return null;

  const separator = spec.indexOf("-");
  if (separator === -1) return null;

  const startRaw = spec.slice(0, separator).trim();
  const endRaw = spec.slice(separator + 1).trim();

  if (!startRaw) {
    const suffixLength = parseRangeNumber(endRaw);
    if (suffixLength == null || suffixLength <= 0) return null;
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = parseRangeNumber(startRaw);
  const end = endRaw ? parseRangeNumber(endRaw) : size - 1;

  if (
    start == null ||
    end == null ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function setMediaCorsHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const origin = request.headers.origin;
  if (origin) {
    reply
      .header("Access-Control-Allow-Origin", origin)
      .header("Access-Control-Allow-Credentials", "true")
      .header("Vary", "Origin");
    return;
  }

  reply.header("Access-Control-Allow-Origin", "*");
}

export async function streamRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  config: AppConfig,
) {
  async function resolveFile(
    fileId: number,
    type: "movie" | "episode",
  ): Promise<StreamFile | null> {
    if (type === "movie") {
      const file = await db.query.movieFiles.findFirst({
        where: eq(movieFiles.id, fileId),
      });
      return file
        ? {
            filePath: file.filePath,
            id: file.id,
            durationMs: file.durationMs,
            width: file.width,
            height: file.height,
            videoCodec: file.videoCodec,
            audioCodec: file.audioCodec,
          }
        : null;
    }

    const episode = await db.query.tvEpisodes.findFirst({
      where: eq(tvEpisodes.id, fileId),
    });
    return episode
      ? {
          filePath: episode.filePath,
          id: episode.id,
          durationMs: episode.durationMs,
          width: episode.width,
          height: episode.height,
          videoCodec: episode.videoCodec,
          audioCodec: episode.audioCodec,
        }
      : null;
  }

  function hasCompleteStreamMetadata(file: StreamFile): boolean {
    return (
      file.durationMs != null &&
      file.durationMs > 0 &&
      file.height != null &&
      file.height > 0 &&
      file.width != null &&
      file.width > 0 &&
      Boolean(file.videoCodec) &&
      Boolean(file.audioCodec)
    );
  }

  async function resolveStreamMetadata(
    file: StreamFile,
    probeIn?: Awaited<ReturnType<typeof probeFile>>,
  ): Promise<{
    height: number | null;
    width: number | null;
    durationMs: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    bitrate: number | null;
  }> {
    if (hasCompleteStreamMetadata(file)) {
      return {
        height: file.height ?? null,
        width: file.width ?? null,
        durationMs: file.durationMs ?? null,
        videoCodec: file.videoCodec ?? null,
        audioCodec: file.audioCodec ?? null,
        bitrate: null,
      };
    }

    const probe = probeIn ?? (await probeFile(file.filePath));
    return {
      height: file.height ?? probe?.height ?? null,
      width: file.width ?? probe?.width ?? null,
      durationMs: file.durationMs ?? probe?.durationMs ?? null,
      videoCodec: file.videoCodec ?? probe?.videoCodec ?? null,
      audioCodec: file.audioCodec ?? probe?.audioCodec ?? null,
      bitrate: probe?.bitrate ?? null,
    };
  }

  async function resolveSourceHeight(
    file: StreamFile,
    probeIn?: Awaited<ReturnType<typeof probeFile>>,
  ): Promise<number | null> {
    if (file.height) return file.height;
    const probe = probeIn ?? (await probeFile(file.filePath));
    return probe?.height ?? null;
  }

  async function resolvePlaybackArtwork(
    fileId: number,
    type: "movie" | "episode",
  ): Promise<{ posterPath: string | null; mediaId: number | null }> {
    if (type === "movie") {
      const row = await db
        .select({
          posterPath: mediaItems.posterPath,
          mediaId: mediaItems.id,
        })
        .from(movieFiles)
        .innerJoin(mediaItems, eq(movieFiles.mediaItemId, mediaItems.id))
        .where(eq(movieFiles.id, fileId))
        .limit(1)
        .then((rows) => rows[0]);

      return {
        posterPath: row?.posterPath ?? null,
        mediaId: row?.mediaId ?? null,
      };
    }

    const row = await db
      .select({
        stillPath: tvEpisodes.stillPath,
        posterPath: mediaItems.posterPath,
        mediaId: mediaItems.id,
      })
      .from(tvEpisodes)
      .innerJoin(tvSeasons, eq(tvEpisodes.seasonId, tvSeasons.id))
      .innerJoin(mediaItems, eq(tvSeasons.mediaItemId, mediaItems.id))
      .where(eq(tvEpisodes.id, fileId))
      .limit(1)
      .then((rows) => rows[0]);

    return {
      posterPath: row?.stillPath ?? row?.posterPath ?? null,
      mediaId: row?.mediaId ?? null,
    };
  }

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId/info",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      let stats: fs.Stats | null = null;
      try {
        stats = fs.statSync(file.filePath);
      } catch {
        return reply.status(404).send({ error: "File not found" });
      }

      let isSymlink = false;
      try {
        isSymlink = fs.lstatSync(file.filePath).isSymbolicLink();
      } catch {
        isSymlink = false;
      }

      let symlinkTarget: string | null = null;
      if (isSymlink) {
        try {
          const link = fs.readlinkSync(file.filePath);
          symlinkTarget = path.isAbsolute(link)
            ? link
            : path.resolve(path.dirname(file.filePath), link);
        } catch {
          symlinkTarget = null;
        }
      }

      const ext = path.extname(file.filePath);
      const mimeType = mime.lookup(ext) || "application/octet-stream";

      // Probe once — metadata + dynamic range come from the same ffprobe.
      // Avoid double ffprobe (metadata then probe) which magnifies load on seek storms.
      const probe = await probeFile(file.filePath);
      const metadata = await resolveStreamMetadata(file, probe);

      const [artwork, progress] = await Promise.all([
        resolvePlaybackArtwork(fileId, type),
        db.query.watchProgress.findFirst({
          where: and(
            eq(watchProgress.itemType, type),
            eq(watchProgress.itemId, fileId),
          ),
        }),
      ]);

      const thumbDir = thumbnailCacheDir(config.transcoding.cache_dir, type, fileId);
      const thumbCached = getCachedThumbnailPaths(thumbDir);
      if (
        !thumbCached &&
        !isThumbnailGenerationPending(thumbDir) &&
        metadata.durationMs &&
        metadata.durationMs > 0
      ) {
        void ensureThumbnailSprite(file.filePath, thumbDir, metadata.durationMs);
      }

      return {
        id: file.id,
        type,
        mimeType,
        fileSize: stats.size,
        fileName: path.basename(file.filePath),
        isSymlink,
        symlinkTarget,
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
        videoCodec: metadata.videoCodec,
        audioCodec: metadata.audioCodec,
        bitrate: metadata.bitrate ?? probe?.bitrate ?? null,
        availableQualities: getAvailableQualities(metadata.height, metadata.width),
        transcodingEnabled: config.transcoding.enabled,
        directPlayAudioSupported: isBrowserDirectPlayAudioSupported(
          metadata.audioCodec,
        ),
        directPlayVideoSupported: isBrowserDirectPlayVideoSupported(
          metadata.videoCodec,
        ),
        originalPlaybackMode: resolveOriginalPlaybackMode({
          audioCodec: metadata.audioCodec,
          videoCodec: metadata.videoCodec,
          transcodingEnabled: config.transcoding.enabled,
          fileName: path.basename(file.filePath),
        }),
        nativeTvPlaybackMode: resolveNativeTvPlaybackMode({
          audioCodec: metadata.audioCodec,
          videoCodec: metadata.videoCodec,
          transcodingEnabled: config.transcoding.enabled,
          dolbyVision: probe?.dynamicRange?.dolbyVision ?? false,
        }),
        dynamicRange: probe?.dynamicRange ?? null,
        thumbnailsReady: Boolean(thumbCached),
        posterPath: artwork.posterPath,
        mediaId: artwork.mediaId,
        watchProgress: progress
          ? {
              positionMs: progress.positionMs,
              durationMs: progress.durationMs,
            }
          : null,
      };
    },
  );

  app.post<{ Params: StreamParams; Body: StreamStopBody }>(
    "/api/stream/:fileId/stop",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.body?.type ?? "movie";
      stopTranscodeSessionsForFile(config.transcoding.cache_dir, type, fileId);
      return { success: true };
    },
  );

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId/thumbnails/thumbs.vtt",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const thumbDir = thumbnailCacheDir(config.transcoding.cache_dir, type, fileId);
      let cached = getCachedThumbnailPaths(thumbDir);

      if (!cached) {
        const metadata = await resolveStreamMetadata(file);
        if (!metadata.durationMs) {
          return reply.status(404).send({ error: "Thumbnails unavailable" });
        }
        cached = await ensureThumbnailSprite(
          file.filePath,
          thumbDir,
          metadata.durationMs,
        );
      }

      if (!cached) {
        return reply.status(404).send({ error: "Thumbnails not ready" });
      }

      reply.header("Content-Type", "text/vtt");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(fs.readFileSync(cached.vttPath, "utf-8"));
    },
  );

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId/thumbnails/sprite.jpg",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const thumbDir = thumbnailCacheDir(config.transcoding.cache_dir, type, fileId);
      const cached = getCachedThumbnailPaths(thumbDir);

      if (!cached) {
        return reply.status(404).send({ error: "Thumbnails not ready" });
      }

      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(fs.createReadStream(cached.spritePath));
    },
  );

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const stats = (() => {
        try {
          return fs.statSync(file.filePath);
        } catch {
          return null;
        }
      })();
      if (!stats) {
        return reply.status(404).send({ error: "File not found" });
      }
      const etag = strongEtagForSize(stats.size, stats.mtimeMs);
      setStrongEtag(reply, etag);
      if (matchConditionalGet(request, reply, etag)) return;

      const ext = path.extname(file.filePath);
      const mimeType = mime.lookup(ext) || "video/mp4";
      const range = request.headers.range;

      if (range) {
        const parsed = parseHttpRange(range, stats.size);

        if (!parsed) {
          setMediaCorsHeaders(request, reply);
          return reply
            .status(416)
            .header("Content-Range", `bytes */${stats.size}`)
            .send({ error: "Invalid range" });
        }

        const { start, end } = parsed;
        const chunkSize = end - start + 1;

        setMediaCorsHeaders(request, reply);
        reply
          .status(206)
          .header("Content-Range", `bytes ${start}-${end}/${stats.size}`)
          .header("Accept-Ranges", "bytes")
          .header("Content-Length", chunkSize)
          .header("Content-Type", mimeType);

        return reply.send(
          fs.createReadStream(file.filePath, {
            start,
            end,
            highWaterMark: STREAM_READ_HIGH_WATER_MARK,
          }),
        );
      }

      setMediaCorsHeaders(request, reply);
      reply
        .header("Content-Length", stats.size)
        .header("Content-Type", mimeType)
        .header("Accept-Ranges", "bytes");

      return reply.send(
        fs.createReadStream(file.filePath, {
          highWaterMark: STREAM_READ_HIGH_WATER_MARK,
        }),
      );
    },
  );

  app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:fileId/hls/master.m3u8",
    async (request, reply) => {
      if (!config.transcoding.enabled) {
        return reply.status(400).send({ error: "Transcoding disabled" });
      }

      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const hlsQuality = parseHlsQuality(request.query.quality) ?? "720p";
      const file = await resolveFile(fileId, type);

      if (!file || !fs.existsSync(file.filePath)) {
        return reply.status(404).send({ error: "File not found" });
      }

      const probe = await probeFile(file.filePath);
      const metadata = await resolveStreamMetadata(file, probe);
      const sourceHeight = file.height ?? probe?.height ?? null;

      if (hlsQuality !== "remux" && !parseTranscodeQuality(hlsQuality)) {
        return reply.status(400).send({
          error: `${hlsQuality} is not a valid transcode quality`,
        });
      }

      const startSeconds = parseStartSeconds(request.query.start);
      const sessionId = createStreamSessionId(type, fileId, hlsQuality, startSeconds);
      const outputDir = path.join(config.transcoding.cache_dir, sessionId);

      stopTranscodeSessionsForFile(
        config.transcoding.cache_dir,
        type,
        fileId,
        sessionId,
      );

      const videoCodec = metadata.videoCodec ?? probe?.videoCodec ?? null;
      if (hlsQuality === "remux" && !isHlsVideoCopySupported(videoCodec)) {
        return reply.status(400).send({
          error: "Remux is not supported for this video codec",
        });
      }

      const sourceDurationSeconds =
        probe?.durationMs && probe.durationMs > 0 ? probe.durationMs / 1000 : 0;

      const startTranscode = () =>
        hlsQuality === "remux"
          ? startHlsRemux(
              sessionId,
              file.filePath,
              outputDir,
              config.transcoding.hls_segment_duration,
              startSeconds,
              metadata.videoCodec,
              probe?.audioStreamIndex,
            )
          : startHlsTranscode(
              sessionId,
              file.filePath,
              outputDir,
              config.transcoding.hls_segment_duration,
              hlsQuality,
              sourceHeight,
              startSeconds,
              probe?.audioStreamIndex,
              probe?.dynamicRange,
            );

      let session = resolveHlsSession(sessionId, outputDir, startSeconds);

      // A session can exist on disk but its ffmpeg is no longer running (it was
      // killed, crashed, or the server restarted). If that transcode did NOT
      // reach the true end of the source, resume it — otherwise the client
      // would poll a frozen partial playlist forever. This is the core fix for
      // "plays the first ~20s then stalls": a SIGTERM'd transcode must never be
      // treated as finished.
      const deadButIncomplete =
        !!session &&
        !isTranscodeInProgress(sessionId) &&
        !isTranscodeComplete(outputDir, sourceDurationSeconds);

      if (!session || deadButIncomplete) {
        const lastServed = session?.lastServedSegmentIndex ?? -1;
        const isResume = deadButIncomplete;
        session = startTranscode();
        session.lastServedSegmentIndex = lastServed;

        // New sessions: 2 segments (~12s) so the client can start sooner and
        // keep buffering. Resume after a dead encode: 1 segment is enough to
        // re-enter the playlist without another ~24s cold wait.
        const minSegments = isResume ? 1 : 2;
        const ready = await waitForFirstSegment(outputDir, 90_000, minSegments);
        if (!ready) {
          stopHlsSession(sessionId);
          const logPath = path.join(outputDir, "ffmpeg.log");
          const logTail = fs.existsSync(logPath)
            ? fs.readFileSync(logPath, "utf-8").slice(-2000)
            : "";
          request.log.error({ sessionId, logTail }, "Transcoding failed to start");
          return reply.status(500).send({ error: "Transcoding failed to start" });
        }
      }

      let inProgress = isTranscodeInProgress(sessionId);
      let playlist = generateHlsPlaylist(
        outputDir,
        config.transcoding.hls_segment_duration,
        inProgress,
        session.lastServedSegmentIndex,
        sourceDurationSeconds,
      );

      // The playlist file can be caught mid-flush by ffmpeg (empty/partial).
      // While the session is still encoding, briefly retry instead of killing
      // a healthy transcode.
      if (!playlist && inProgress) {
        const ready = await waitForFirstSegment(outputDir, 3_000, 1);
        if (ready) {
          inProgress = isTranscodeInProgress(sessionId);
          playlist = generateHlsPlaylist(
            outputDir,
            config.transcoding.hls_segment_duration,
            inProgress,
            session.lastServedSegmentIndex,
            sourceDurationSeconds,
          );
        }
      }

      if (!playlist) {
        // Don't kill a live, actively-serving session just because we caught
        // the playlist file mid-flush — that would freeze playback. Only fail
        // hard when there's genuinely no session running.
        if (!isTranscodeInProgress(sessionId)) {
          stopHlsSession(sessionId);
          return reply.status(500).send({ error: "Transcoding failed to start" });
        }
        return reply.status(503).header("Retry-After", "1").send({ error: "Playlist not ready" });
      }

      const useAbsolute = request.query.cast === "1";
      const baseUrl = useAbsolute
        ? (request.query.base
            ? decodeURIComponent(request.query.base)
            : getCastBaseUrl(request, config))
        : "";
      const castToken = request.query.castToken;
      const tokenSuffix = castToken
        ? `&castToken=${encodeURIComponent(castToken)}`
        : "";

      const rewritten = playlist.replace(
        /segment_\d+\.ts/g,
        (match) => {
          const segmentPath = `/api/stream/${fileId}/hls/${match}?type=${type}&quality=${hlsQuality}&start=${Math.floor(startSeconds)}${tokenSuffix}`;
          return useAbsolute ? toAbsoluteUrl(baseUrl, segmentPath) : segmentPath;
        },
      );

      const etag = strongEtagForString(rewritten);
      setStrongEtag(reply, etag);
      // Do not 304 during in-progress (growing) playlist — client needs fresh manifest,
      // but we still include ETag for post-complete caching.
      if (!inProgress && matchConditionalGet(request, reply, etag)) return;

      setMediaCorsHeaders(request, reply);
      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      if (inProgress) {
        reply.header("Cache-Control", "no-store");
      }
      return rewritten;
    },
  );

  app.get<{ Params: { fileId: string; segment: string }; Querystring: StreamQuery }>(
    "/api/stream/:fileId/hls/:segment",
    async (request, reply) => {
      const fileId = parseInt(request.params.fileId, 10);
      const type = request.query.type ?? "movie";
      const quality = parseHlsQuality(request.query.quality) ?? "720p";
      const startSeconds = parseStartSeconds(request.query.start);
      const sessionId = createStreamSessionId(type, fileId, quality, startSeconds);
      const outputDir = path.join(config.transcoding.cache_dir, sessionId);

      const segmentName = request.params.segment;
      if (!/^segment_\d+\.ts$/.test(segmentName)) {
        return reply.status(400).send({ error: "Invalid segment name" });
      }

      const session =
        getHlsSession(sessionId) ??
        resolveHlsSession(sessionId, outputDir, startSeconds);
      if (!session) {
        return reply.status(404).send({ error: "HLS session not found" });
      }

      session.lastServedSegmentIndex = Math.max(
        session.lastServedSegmentIndex,
        parseHlsSegmentIndex(segmentName),
      );

      const segmentPath = path.join(session.outputDir, segmentName);
      let segmentStats: fs.Stats | null = null;
      try {
        segmentStats = fs.statSync(segmentPath);
      } catch {
        segmentStats = null;
      }

      if (!segmentStats || segmentStats.size === 0) {
        if (isTranscodeInProgress(sessionId)) {
          const ready = await waitForHlsSegment(session.outputDir, segmentName);
          if (!ready) {
            return reply.status(404).send({ error: "Segment not found" });
          }
          try {
            segmentStats = fs.statSync(segmentPath);
          } catch {
            return reply.status(404).send({ error: "Segment not found" });
          }
          if (segmentStats.size === 0) {
            return reply.status(404).send({ error: "Segment not found" });
          }
        } else {
          return reply.status(404).send({ error: "Segment not found" });
        }
      }

      {
        const etag = strongEtagForSize(segmentStats.size, segmentStats.mtimeMs);
        setStrongEtag(reply, etag);
        if (
          !isTranscodeInProgress(sessionId) &&
          matchConditionalGet(request, reply, etag)
        ) {
          return;
        }
      }

      setMediaCorsHeaders(request, reply);
      reply.header("Content-Type", "video/mp2t");
      if (!isTranscodeInProgress(sessionId)) {
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
      }
      return reply.send(fs.createReadStream(segmentPath));
    },
  );
}

export async function subtitleRoutes(
  app: FastifyInstance,
  db: DatabaseInstance,
  subtitleService: SubtitleService,
) {
  app.get<{ Params: { id: string }; Querystring: { offset?: string } }>(
    "/api/subtitles/:id",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      // Fractional seconds (ms precision) keep native HLS cues aligned after resume.
      const rawOffset = Number.parseFloat(request.query.offset ?? "0");
      const offsetSeconds =
        Number.isFinite(rawOffset) && rawOffset > 0 ? Math.round(rawOffset * 1000) / 1000 : 0;
      const subtitle = await db.query.subtitles.findFirst({
        where: eq(subtitles.id, id),
      });

      if (!subtitle) {
        return reply.status(404).send({ error: "Subtitle not found" });
      }

      try {
        const content = await subtitleService.getSubtitleContent(subtitle);
        if (!subtitleHasContent(content)) {
          await subtitleService.deleteSubtitle(id);
          return reply.status(404).send({ error: "Subtitle has no content" });
        }
        const body = offsetSeconds > 0 ? shiftVttByOffset(content, offsetSeconds) : content;
        if (!subtitleHasContent(body)) {
          return reply.status(404).send({ error: "Subtitle has no content" });
        }
        setMediaCorsHeaders(request, reply);
        reply.header("Content-Type", "text/vtt");
        return body;
      } catch {
        return reply.status(500).send({ error: "Failed to read subtitle" });
      }
    },
  );
}
