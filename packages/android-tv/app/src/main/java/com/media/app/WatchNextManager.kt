package com.media.app

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.BaseColumns
import android.media.tv.TvContract
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram

/** Publishes native playback to the Android TV launcher Continue Watching row. */
class WatchNextManager(context: Context) {
    private val resolver: ContentResolver = context.contentResolver

    fun update(payload: PlaybackPayload, positionMs: Long, durationMs: Long, ended: Boolean = false) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || durationMs <= 0L) return

        val itemType = if (payload.itemType == "episode") {
            TvContract.PreviewPrograms.TYPE_TV_EPISODE
        } else {
            TvContract.PreviewPrograms.TYPE_MOVIE
        }
        val intentUri = playbackIntent(payload)
        val existingId = findProgramId(intentUri)
        if (ended) {
            if (existingId != null) {
                try {
                    resolver.delete(
                        TvContractCompat.buildWatchNextProgramUri(existingId),
                        null,
                        null,
                    )
                } catch (_: SecurityException) {
                    // Some TV launchers do not expose the Watch Next provider to third-party apps.
                }
            }
            return
        }

        val values = WatchNextProgram.Builder()
            .setType(itemType)
            .setWatchNextType(TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
            .setContentId("${payload.itemType}:${payload.fileId}")
            .setTitle(payload.title)
            .setDurationMillis(durationMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
            .setLastPlaybackPositionMillis(
                positionMs.coerceAtLeast(0L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
            )
            .setLastEngagementTimeUtcMillis(System.currentTimeMillis())
            .setIntentUri(intentUri)
            .apply {
                payload.posterUrl?.let { setPosterArtUri(Uri.parse(it)) }
            }
            .build()

        try {
            if (existingId != null) {
                resolver.update(
                    TvContractCompat.buildWatchNextProgramUri(existingId),
                    values.toContentValues(),
                    null,
                    null,
                )
            } else {
                resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, values.toContentValues())
            }
        } catch (_: SecurityException) {
            // Some TV launchers do not expose the Watch Next provider to third-party apps.
        }
    }

    private fun playbackIntent(payload: PlaybackPayload): Uri {
        return Uri.Builder()
            .scheme("media")
            .authority("watch")
            .appendQueryParameter("type", payload.itemType)
            .appendQueryParameter("fileId", payload.fileId.toString())
            .build()
    }

    private fun findProgramId(intentUri: Uri): Long? {
        return try {
            resolver.query(
                TvContractCompat.WatchNextPrograms.CONTENT_URI,
                arrayOf(BaseColumns._ID),
                "${TvContractCompat.WatchNextPrograms.COLUMN_INTENT_URI} = ?",
                arrayOf(intentUri.toString()),
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getLong(0) else null
            }
        } catch (_: SecurityException) {
            null
        }
    }

}
