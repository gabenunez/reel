package com.media.app

import org.json.JSONObject

data class PlaybackPayload(
    val url: String,
    val title: String,
    val fileId: Int,
    val itemType: String,
    val startSeconds: Double,
    val durationMs: Long,
    val isHls: Boolean,
    val subtitleUrl: String?,
    val isHdr: Boolean,
    val dolbyVision: Boolean,
) {
    companion object {
        fun parse(json: String): PlaybackPayload? {
            return try {
                val obj = JSONObject(json)
                PlaybackPayload(
                    url = obj.getString("url"),
                    title = obj.optString("title", "MEDIA!"),
                    fileId = obj.getInt("fileId"),
                    itemType = obj.getString("itemType"),
                    startSeconds = obj.optDouble("startSeconds", 0.0),
                    durationMs = obj.optLong("durationMs", 0L),
                    isHls = obj.optBoolean("isHls", false),
                    subtitleUrl = obj.optString("subtitleUrl").takeIf { it.isNotBlank() },
                    isHdr = obj.optBoolean("isHdr", false),
                    dolbyVision = obj.optBoolean("dolbyVision", false),
                )
            } catch (_: Exception) {
                null
            }
        }
    }
}
