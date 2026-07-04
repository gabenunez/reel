package com.media.app

import android.content.Context
import android.webkit.CookieManager

object AuthSession {
    /** Resolve auth token from WebView cookies first, then persisted prefs. */
    fun resolveSessionToken(context: Context, serverUrl: String): String? {
        val fromCookie = parseSessionFromCookie(
            CookieManager.getInstance().getCookie(serverUrl.trimEnd('/')),
        )
        if (!fromCookie.isNullOrBlank()) {
            SessionPreferences.saveSessionToken(context, fromCookie)
            return fromCookie
        }

        return SessionPreferences.getSessionToken(context)
    }

    fun requestHeaders(token: String?): Map<String, String> {
        if (token.isNullOrBlank()) return emptyMap()
        return mapOf("Cookie" to "media_session=$token; reel_session=$token")
    }

    private fun parseSessionFromCookie(cookieHeader: String?): String? {
        if (cookieHeader.isNullOrBlank()) return null

        for (part in cookieHeader.split(";")) {
            val trimmed = part.trim()
            for (prefix in listOf("media_session=", "reel_session=")) {
                if (trimmed.startsWith(prefix)) {
                    val value = trimmed.removePrefix(prefix).trim()
                    if (value.isNotEmpty() && value != "deleted") {
                        return value
                    }
                }
            }
        }

        return null
    }
}
