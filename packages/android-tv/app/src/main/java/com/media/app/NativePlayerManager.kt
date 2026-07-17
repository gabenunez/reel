package com.media.app

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.effect.Presentation
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject

class NativePlayerManager(
    private val playerView: PlayerView,
    private val emitJs: (String) -> Unit,
    private val onPlaybackStopped: () -> Unit = {},
    private val onHdrContentChanged: (Boolean) -> Unit = {},
    private val watchNextManager: WatchNextManager? = null,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var seekApplied = false
    private var serverUrl: String = ""
    private var sessionToken: String? = null
    private var currentPayload: PlaybackPayload? = null
    private var mediaSessionManager: PlaybackMediaSessionManager? = null
    private var displayMode: String = "fit"
    private var hdrContentActive = false
    private var subtitleStylesJson: String? = null
    private var lastWatchNextUpdateMs = 0L
    private var playbackEnded = false
    private var lastPlaybackPositionMs = 0L
    private var lastPlaybackProgressAtMs = 0L
    private var stallRecoveryAttempts = 0
    private var stallRecoveryPending = false
    private var playbackFailureReported = false
    private var hasReachedReady = false
    private var stallRecoveryRunnable: Runnable? = null

    private val progressRunnable = object : Runnable {
        override fun run() {
            emitState()
            handler.postDelayed(this, PROGRESS_INTERVAL_MS)
        }
    }

    fun play(serverUrl: String, sessionToken: String?, payload: PlaybackPayload) {
        this.serverUrl = serverUrl
        this.sessionToken = sessionToken
        currentPayload = payload
        seekApplied = false
        lastWatchNextUpdateMs = 0L
        playbackEnded = false
        lastPlaybackPositionMs = 0L
        lastPlaybackProgressAtMs = System.currentTimeMillis()
        stallRecoveryAttempts = 0
        stallRecoveryPending = false
        playbackFailureReported = false
        hasReachedReady = false
        cancelStallRecovery()

        releasePlayer()
        playerView.visibility = View.VISIBLE

        val mediaSourceFactory = authenticatedMediaSourceFactory(sessionToken)
        val loadControl =
            DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                    30_000,
                    120_000,
                    5_000,
                    15_000,
                )
                .setBackBuffer(60_000, true)
                .build()
        val exoPlayer =
            ExoPlayer.Builder(playerView.context)
                .setMediaSourceFactory(mediaSourceFactory)
                .setLoadControl(loadControl)
                .build()

        player = exoPlayer
        playerView.player = exoPlayer
        playerView.useController = false
        playerView.setShutterBackgroundColor(Color.TRANSPARENT)
        playerView.subtitleView?.visibility = View.VISIBLE
        applyStoredSubtitleStyles()
        exoPlayer.trackSelectionParameters =
            exoPlayer.trackSelectionParameters
                .buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, payload.subtitleUrl.isNullOrBlank())
                .build()
        // Engage HDR window color mode before prepare so the first frame is
        // already presented on an HDR surface (late flips often stay SDR).
        if (payload.isHdr || payload.dolbyVision) {
            setHdrContentActive(true)
        }
        mediaSessionManager?.release()
        mediaSessionManager = PlaybackMediaSessionManager(playerView.context, exoPlayer)

        exoPlayer.setMediaItem(buildMediaItem(payload))
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true

        exoPlayer.addListener(
            object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    when (playbackState) {
                        Player.STATE_READY -> {
                            hasReachedReady = true
                            if (!payload.isHls && payload.startSeconds > 0 && !seekApplied) {
                                val startMs = (payload.startSeconds * 1000).toLong()
                                markPlaybackProgress(startMs)
                                exoPlayer.seekTo(startMs)
                                seekApplied = true
                            }
                            updateHdrOutput(exoPlayer)
                            applySdUpscaleEffect(exoPlayer)
                            applyDisplayMode()
                            applyStoredSubtitleStyles()
                            emitState()
                        }

                        Player.STATE_ENDED -> {
                            playbackEnded = true
                            saveProgress(exoPlayer.duration, ended = true)
                            emitJs("window.__mediaNativePlayer?.onEnded?.()")
                            stop()
                        }

                        else -> emitState()
                    }
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    emitState()
                }

                override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                    // SubtitleView can briefly be hidden/reset when a subtitle
                    // media item is swapped while playback is already ready.
                    // Reassert it when ExoPlayer publishes the new text track.
                    playerView.subtitleView?.visibility = View.VISIBLE
                    applyStoredSubtitleStyles()
                    emitState()
                }

                override fun onVideoSizeChanged(videoSize: VideoSize) {
                    updateHdrOutput(exoPlayer)
                    applySdUpscaleEffect(exoPlayer)
                    applyDisplayMode()
                }

                override fun onPlayerError(error: PlaybackException) {
                    Log.e(
                        TAG,
                        "ExoPlayer error code=${error.errorCode} (${error.errorCodeName}) url=${payload.url}",
                        error,
                    )
                    // Permanent failures (HTTP 4xx, unsupported container, decoder
                    // init) should hand off to the web remux/HLS ladder immediately
                    // instead of burning local seek+prepare retries.
                    if (!isTransientPlaybackError(error) ||
                        !schedulePlaybackRecovery(exoPlayer, "error", maxAttempts = 1)
                    ) {
                        reportPlaybackFailure()
                    }
                    emitState()
                }
            },
        )

        handler.removeCallbacks(progressRunnable)
        handler.post(progressRunnable)
    }

    fun pause() {
        player?.pause()
        lastPlaybackProgressAtMs = System.currentTimeMillis()
        emitState()
    }

    fun isPlaying(): Boolean = player?.isPlaying == true

    fun isActive(): Boolean = playerView.visibility == View.VISIBLE && player != null

    fun togglePlayPause() {
        val exoPlayer = player ?: return
        if (exoPlayer.isPlaying) {
            exoPlayer.pause()
        } else {
            exoPlayer.play()
        }
        emitState()
    }

    fun currentPositionMs(): Long = player?.currentPosition ?: 0L

    fun resume() {
        lastPlaybackProgressAtMs = System.currentTimeMillis()
        player?.play()
        emitState()
    }

    fun syncPlaybackState() {
        emitState()
    }

    fun seekTo(positionMs: Long) {
        val target = positionMs.coerceAtLeast(0L)
        // Scrubs (including backward) must reset the stall clock so the
        // buffering watchdog does not treat a lower position as a stall.
        markPlaybackProgress(target)
        player?.seekTo(target)
        emitState()
    }

    fun updateSubtitles(subtitleUrl: String?): Boolean {
        val exoPlayer = player ?: return false
        val payload = currentPayload ?: return false

        val normalizedUrl = subtitleUrl?.takeIf { it.isNotBlank() }
        if (payload.subtitleUrl == normalizedUrl) return true

        val position = exoPlayer.currentPosition
        val wasPlaying = exoPlayer.isPlaying

        currentPayload = payload.copy(subtitleUrl = normalizedUrl)

        exoPlayer.trackSelectionParameters =
            exoPlayer.trackSelectionParameters
                .buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, normalizedUrl == null)
                .build()

        exoPlayer.replaceMediaItem(0, buildMediaItem(currentPayload!!))
        // Explicitly prepare every hot-swapped item. Relying on the existing
        // READY state can leave the new text renderer unprepared until the
        // entire video is reopened.
        markPlaybackProgress(position)
        exoPlayer.prepare()
        exoPlayer.seekTo(position)
        exoPlayer.playWhenReady = wasPlaying
        playerView.subtitleView?.visibility = View.VISIBLE
        applyStoredSubtitleStyles()
        emitState()
        return true
    }

    fun applySubtitleStyles(json: String): Boolean {
        subtitleStylesJson = json
        applyStoredSubtitleStyles()
        return true
    }

    private fun applyStoredSubtitleStyles(): Boolean {
        val json = subtitleStylesJson ?: return false
        return SubtitleStyleMapper.apply(playerView.subtitleView, json)
    }

    fun stop() {
        handler.removeCallbacks(progressRunnable)
        cancelStallRecovery()
        if (!playbackEnded) {
            saveProgress(player?.currentPosition ?: 0L, ended = false)
        }
        setHdrContentActive(false)
        releasePlayer()
        playerView.visibility = View.GONE
        playerView.scaleX = 1f
        playerView.scaleY = 1f
        currentPayload = null
        playbackEnded = false
        stallRecoveryPending = false
        playbackFailureReported = false
        hasReachedReady = false
        onPlaybackStopped()
    }

    fun setDisplayMode(mode: String) {
        displayMode =
            when (mode) {
                "fill", "stretch" -> mode
                else -> "fit"
            }
        applyDisplayMode()
    }

    private fun applySdUpscaleEffect(exoPlayer: ExoPlayer) {
        // Media3's setVideoEffects() switches rendering onto the GPU video-graph
        // path, which tone-maps HDR/DV to SDR on most Android TV SoCs. Never
        // touch effects for HDR content — and never call setVideoEffects with
        // an empty list as a "no-op", since that still enables the graph.
        if (isHdrPayload() || hdrContentActive) {
            return
        }

        val sourceH = exoPlayer.videoSize.height
        if (sourceH <= 0) return

        val metrics = playerView.context.resources.displayMetrics
        val screenMax = maxOf(metrics.widthPixels, metrics.heightPixels)
        if (screenMax < 2160 || sourceH > 576) {
            return
        }

        // Upscale SD to 720p in the GPU pipeline before the display scaler — softer on 4K TVs.
        val targetH = 720
        if (sourceH >= targetH) {
            return
        }

        exoPlayer.setVideoEffects(listOf(Presentation.createForHeight(targetH)))
    }

    private fun applyDisplayMode() {
        playerView.scaleX = 1f
        playerView.scaleY = 1f
        playerView.pivotX = playerView.width / 2f
        playerView.pivotY = playerView.height / 2f

        when (displayMode) {
            "fill" -> playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            "stretch" -> {
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                playerView.post { applyStretchScale() }
            }
            else -> playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    private fun applyStretchScale() {
        val exoPlayer = player ?: return
        val videoSize = exoPlayer.videoSize
        if (videoSize.width <= 0 || videoSize.height <= 0) return

        val containerW = playerView.width.toFloat()
        val containerH = playerView.height.toFloat()
        if (containerW <= 0f || containerH <= 0f) return

        val videoAspect =
            videoSize.width.toFloat() * videoSize.pixelWidthHeightRatio / videoSize.height.toFloat()
        val containerAspect = containerW / containerH

        val fittedW: Float
        val fittedH: Float
        if (videoAspect > containerAspect) {
            fittedW = containerW
            fittedH = containerW / videoAspect
        } else {
            fittedH = containerH
            fittedW = containerH * videoAspect
        }

        playerView.scaleX = containerW / fittedW
        playerView.scaleY = containerH / fittedH
    }

    fun release() {
        handler.removeCallbacks(progressRunnable)
        releasePlayer()
        playerView.visibility = View.GONE
    }

    private fun releasePlayer() {
        mediaSessionManager?.release()
        mediaSessionManager = null
        playerView.player = null
        player?.release()
        player = null
    }

    private fun isHdrPayload(): Boolean {
        val payload = currentPayload ?: return false
        return payload.isHdr || payload.dolbyVision
    }

    private fun isHdrFormat(exoPlayer: ExoPlayer): Boolean {
        // Server probe is authoritative. ExoPlayer ColorInfo is often missing
        // or incomplete for MKV HDR10 (transfer stays UNSPECIFIED), and a
        // false "SDR" reading would flip the window out of COLOR_MODE_HDR.
        if (isHdrPayload()) return true

        val format = exoPlayer.videoFormat ?: return hdrContentActive

        // Dolby Vision sample MIME (dvhe/dvh1) — engage HDR output.
        if (format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION) return true

        val colorInfo = format.colorInfo ?: return hdrContentActive
        return when (colorInfo.colorTransfer) {
            C.COLOR_TRANSFER_ST2084, C.COLOR_TRANSFER_HLG -> true
            else -> false
        }
    }

    private fun updateHdrOutput(exoPlayer: ExoPlayer) {
        if (exoPlayer.playbackState != Player.STATE_READY) return
        // Only ever promote to HDR from the decoder; never demote a payload
        // that already declared HDR/DV (incomplete ColorInfo must not win).
        if (isHdrFormat(exoPlayer)) {
            setHdrContentActive(true)
        }
    }

    private fun setHdrContentActive(active: Boolean) {
        if (hdrContentActive == active) return
        hdrContentActive = active
        onHdrContentChanged(active)
    }

    private fun buildMediaItem(request: PlaybackPayload): MediaItem {
        val builder = MediaItem.Builder()
            .setUri(request.url)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(request.title)
                    .build(),
            )

        mimeTypeForUrl(request.url)?.let { builder.setMimeType(it) }

        if (!request.subtitleUrl.isNullOrBlank()) {
            builder.setSubtitleConfigurations(
                listOf(
                    MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(request.subtitleUrl))
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                        .build(),
                ),
            )
        }

        return builder.build()
    }

    private fun mimeTypeForUrl(url: String): String? {
        val path = url.substringBefore('?').substringBefore('#').lowercase()
        return when {
            path.endsWith(".mkv") -> MimeTypes.VIDEO_MATROSKA
            path.endsWith(".webm") -> MimeTypes.VIDEO_WEBM
            path.endsWith(".mp4") || path.endsWith(".m4v") -> MimeTypes.VIDEO_MP4
            path.endsWith(".mov") -> MimeTypes.VIDEO_MP4
            path.endsWith(".ts") || path.endsWith(".m2ts") || path.endsWith(".mts") ->
                MimeTypes.VIDEO_MP2T
            path.contains(".m3u8") -> MimeTypes.APPLICATION_M3U8
            else -> null
        }
    }

    private fun emitState() {
        val exoPlayer = player ?: return
        val now = System.currentTimeMillis()
        val currentPositionMs = exoPlayer.currentPosition
        if (currentPositionMs > lastPlaybackPositionMs) {
            markPlaybackProgress(currentPositionMs)
            stallRecoveryAttempts = 0
        } else if (
            exoPlayer.playWhenReady &&
            exoPlayer.playbackState == Player.STATE_BUFFERING &&
            now - lastPlaybackProgressAtMs >= stallTimeoutMs()
        ) {
            if (!schedulePlaybackRecovery(exoPlayer, "buffering watchdog")) {
                reportPlaybackFailure()
            }
        }
        val durationMs = when {
            exoPlayer.duration > 0 -> exoPlayer.duration
            (currentPayload?.durationMs ?: 0L) > 0 -> currentPayload!!.durationMs
            else -> 0L
        }

        val payload = JSONObject()
            .put("currentTime", exoPlayer.currentPosition / 1000.0)
            .put("duration", durationMs / 1000.0)
            .put("buffered", exoPlayer.bufferedPosition / 1000.0)
            .put("bufferedRanges", buildBufferedRanges(exoPlayer))
            .put("isPlaying", exoPlayer.isPlaying)
            .put(
                "isBuffering",
                exoPlayer.playbackState == Player.STATE_BUFFERING,
            )
            .put("ready", exoPlayer.playbackState == Player.STATE_READY)

        if (System.currentTimeMillis() - lastWatchNextUpdateMs >= WATCH_NEXT_UPDATE_INTERVAL_MS) {
            currentPayload?.let {
                watchNextManager?.update(it, exoPlayer.currentPosition, durationMs)
            }
            lastWatchNextUpdateMs = System.currentTimeMillis()
        }

        emitJs("window.__mediaNativePlayer?.onState?.($payload)")
    }

    private fun stallTimeoutMs(): Long =
        if (hasReachedReady) STALL_TIMEOUT_MS else INITIAL_BUFFER_GRACE_MS

    private fun markPlaybackProgress(positionMs: Long) {
        lastPlaybackPositionMs = positionMs.coerceAtLeast(0L)
        lastPlaybackProgressAtMs = System.currentTimeMillis()
    }

    private fun cancelStallRecovery() {
        stallRecoveryRunnable?.let { handler.removeCallbacks(it) }
        stallRecoveryRunnable = null
        stallRecoveryPending = false
    }

    /**
     * Local seek+prepare can clear brief network/glitch stalls. Permanent source
     * errors should fail through to the web remux/HLS fallback immediately.
     */
    private fun isTransientPlaybackError(error: PlaybackException): Boolean {
        return when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
            PlaybackException.ERROR_CODE_TIMEOUT,
            PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW,
            PlaybackException.ERROR_CODE_REMOTE_ERROR,
            -> true
            else -> false
        }
    }

    private fun schedulePlaybackRecovery(
        exoPlayer: ExoPlayer,
        reason: String,
        maxAttempts: Int = MAX_STALL_RECOVERY_ATTEMPTS,
    ): Boolean {
        if (stallRecoveryPending || exoPlayer !== player) return true
        if (stallRecoveryAttempts >= maxAttempts) return false

        stallRecoveryAttempts++
        stallRecoveryPending = true
        val positionMs = exoPlayer.currentPosition
        Log.w(
            TAG,
            "Recovering playback attempt=$stallRecoveryAttempts/$maxAttempts reason=$reason positionMs=$positionMs",
        )
        val runnable = Runnable {
            stallRecoveryRunnable = null
            if (exoPlayer !== player || playbackEnded) {
                stallRecoveryPending = false
                return@Runnable
            }
            stallRecoveryPending = false
            markPlaybackProgress(positionMs)
            exoPlayer.seekTo(positionMs.coerceAtLeast(0L))
            exoPlayer.prepare()
            exoPlayer.playWhenReady = true
        }
        stallRecoveryRunnable = runnable
        handler.postDelayed(runnable, RECOVERY_DELAY_MS)
        return true
    }

    private fun reportPlaybackFailure() {
        if (playbackFailureReported) return
        playbackFailureReported = true
        cancelStallRecovery()
        emitJs("window.__mediaNativePlayer?.onError?.()")
    }

    private fun buildBufferedRanges(exoPlayer: ExoPlayer): org.json.JSONArray {
        val ranges = org.json.JSONArray()
        val bufferedEndMs = exoPlayer.bufferedPosition
        if (bufferedEndMs <= 0L) return ranges

        ranges.put(
            org.json.JSONObject()
                .put("start", 0.0)
                .put("end", bufferedEndMs / 1000.0),
        )
        return ranges
    }

    private fun saveProgress(positionMs: Long, ended: Boolean) {
        val payload = currentPayload ?: return
        val durationMs = if (payload.durationMs > 0) {
            payload.durationMs
        } else {
            player?.duration?.takeIf { it > 0 } ?: return
        }

        watchNextManager?.update(payload, positionMs, durationMs, ended)

        ServerConnector.saveProgress(
            serverUrl = serverUrl,
            sessionToken = sessionToken,
            itemType = payload.itemType,
            itemId = payload.fileId,
            positionMs = if (ended) durationMs else positionMs,
            durationMs = durationMs,
        )
    }

    companion object {
        private const val TAG = "MediaNativePlayer"
        private const val PROGRESS_INTERVAL_MS = 500L
        private const val WATCH_NEXT_UPDATE_INTERVAL_MS = 15_000L
        /** After first READY, how long buffering may stall before local recovery. */
        private const val STALL_TIMEOUT_MS = 30_000L
        /** Cold open (esp. 4K/HLS) may buffer >30s before the first frame. */
        private const val INITIAL_BUFFER_GRACE_MS = 90_000L
        private const val RECOVERY_DELAY_MS = 500L
        private const val MAX_STALL_RECOVERY_ATTEMPTS = 2
    }
}
