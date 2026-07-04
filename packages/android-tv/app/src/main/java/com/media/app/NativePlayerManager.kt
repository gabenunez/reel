package com.media.app

import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.json.JSONObject

class NativePlayerManager(
    private val playerView: PlayerView,
    private val emitJs: (String) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var seekApplied = false
    private var serverUrl: String = ""
    private var sessionToken: String? = null
    private var currentPayload: PlaybackPayload? = null
    private var mediaSessionManager: PlaybackMediaSessionManager? = null

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
                            if (!payload.isHls && payload.startSeconds > 0 && !seekApplied) {
                                exoPlayer.seekTo((payload.startSeconds * 1000).toLong())
                                seekApplied = true
                            }
                            emitState()
                        }

                        Player.STATE_ENDED -> {
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

                override fun onPlayerError(error: PlaybackException) {
                    emitJs("window.__mediaNativePlayer?.onError?.()")
                    emitState()
                }
            },
        )

        handler.removeCallbacks(progressRunnable)
        handler.post(progressRunnable)
    }

    fun pause() {
        player?.pause()
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
        player?.play()
        emitState()
    }

    fun seekTo(positionMs: Long) {
        player?.seekTo(positionMs.coerceAtLeast(0L))
        emitState()
    }

    fun stop() {
        handler.removeCallbacks(progressRunnable)
        saveProgress(player?.currentPosition ?: 0L, ended = false)
        releasePlayer()
        playerView.visibility = View.GONE
        currentPayload = null
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
        val durationMs = when {
            exoPlayer.duration > 0 -> exoPlayer.duration
            (currentPayload?.durationMs ?: 0L) > 0 -> currentPayload!!.durationMs
            else -> 0L
        }

        val payload = JSONObject()
            .put("currentTime", exoPlayer.currentPosition / 1000.0)
            .put("duration", durationMs / 1000.0)
            .put("buffered", exoPlayer.bufferedPosition / 1000.0)
            .put("isPlaying", exoPlayer.isPlaying)
            .put(
                "isBuffering",
                exoPlayer.playbackState == Player.STATE_BUFFERING ||
                    exoPlayer.playbackState == Player.STATE_IDLE,
            )
            .put("ready", exoPlayer.playbackState == Player.STATE_READY)

        emitJs("window.__mediaNativePlayer?.onState?.($payload)")
    }

    private fun saveProgress(positionMs: Long, ended: Boolean) {
        val payload = currentPayload ?: return
        val durationMs = if (payload.durationMs > 0) {
            payload.durationMs
        } else {
            player?.duration?.takeIf { it > 0 } ?: return
        }

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
        private const val PROGRESS_INTERVAL_MS = 500L
    }
}
