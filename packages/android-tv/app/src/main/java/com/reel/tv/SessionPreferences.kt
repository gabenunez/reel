package com.reel.tv

import android.content.Context

object SessionPreferences {
    private const val PREFS_NAME = "reel_tv"
    private const val KEY_SESSION_TOKEN = "session_token"

    fun getSessionToken(context: Context): String? {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_SESSION_TOKEN, null)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
    }

    fun saveSessionToken(context: Context, token: String?) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .apply {
                if (token.isNullOrBlank()) {
                    remove(KEY_SESSION_TOKEN)
                } else {
                    putString(KEY_SESSION_TOKEN, token.trim())
                }
            }
            .apply()
    }

    fun clearSessionToken(context: Context) {
        saveSessionToken(context, null)
    }
}
