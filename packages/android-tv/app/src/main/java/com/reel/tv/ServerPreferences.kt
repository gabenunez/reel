package com.reel.tv

import android.content.Context

object ServerPreferences {
    private const val PREFS_NAME = "reel_tv"
    private const val KEY_SERVER_URL = "server_url"

    fun getServerUrl(context: Context): String? {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_SERVER_URL, null)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
    }

    fun saveServerUrl(context: Context, url: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, url.trim())
            .apply()
    }

    fun clearServerUrl(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_SERVER_URL)
            .apply()
        SessionPreferences.clearSessionToken(context)
    }

    fun normalizeServerUrl(hostInput: String, portInput: String): String? {
        var host = hostInput.trim()
        if (host.isEmpty()) return null

        if (host.startsWith("http://", ignoreCase = true) || host.startsWith("https://", ignoreCase = true)) {
            return host.trimEnd('/')
        }

        host = host.removePrefix("//")
        val port = portInput.trim().ifEmpty { "8096" }
        return "http://$host:$port"
    }
}
