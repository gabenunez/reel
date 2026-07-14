package com.media.app

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder

data class ConnectResult(
    val success: Boolean,
    val error: String? = null,
    val sessionToken: String? = null,
    val passwordRequired: Boolean = false,
    /** Server base URL including public_prefix when configured (e.g. http://host:8096/reel). */
    val serverUrl: String? = null,
)

object ServerConnector {
    fun connect(serverUrl: String, password: String?): ConnectResult {
        val authStatus = fetchAuthStatus(serverUrl)
            ?: return ConnectResult(success = false, error = "Could not reach MEDIA! at that address.")

        val resolvedUrl = applyPublicPrefix(serverUrl, authStatus.publicPrefix)

        if (!authStatus.required) {
            return ConnectResult(
                success = true,
                passwordRequired = false,
                serverUrl = resolvedUrl,
            )
        }

        if (password.isNullOrBlank()) {
            return ConnectResult(
                success = false,
                error = "Password required",
                passwordRequired = true,
                serverUrl = resolvedUrl,
            )
        }

        when (val login = login(resolvedUrl, password)) {
            is LoginResult.Success -> {
                return ConnectResult(
                    success = true,
                    sessionToken = login.token,
                    passwordRequired = true,
                    serverUrl = resolvedUrl,
                )
            }
            is LoginResult.Failure -> {
                return ConnectResult(
                    success = false,
                    error = login.error,
                    passwordRequired = true,
                    serverUrl = resolvedUrl,
                )
            }
        }
    }

    /** Append server.public_prefix when the saved URL is only host[:port]. */
    internal fun applyPublicPrefix(serverUrl: String, publicPrefix: String): String {
        val trimmed = serverUrl.trimEnd('/')
        val prefix = normalizePublicPrefix(publicPrefix)
        if (prefix.isEmpty()) return trimmed

        return try {
            val uri = java.net.URI(trimmed)
            val path = (uri.path ?: "").trimEnd('/')
            if (path == prefix || path.startsWith("$prefix/")) {
                trimmed
            } else {
                "$trimmed$prefix"
            }
        } catch (_: Exception) {
            if (trimmed.endsWith(prefix)) trimmed else "$trimmed$prefix"
        }
    }

    private fun normalizePublicPrefix(value: String): String {
        val trimmed = value.trim().trimEnd('/')
        if (trimmed.isEmpty() || trimmed == "/") return ""
        return if (trimmed.startsWith("/")) trimmed else "/$trimmed"
    }

    private sealed class LoginResult {
        data class Success(val token: String) : LoginResult()
        data class Failure(val error: String) : LoginResult()
    }

    private data class AuthStatus(
        val required: Boolean,
        val authenticated: Boolean,
        val publicPrefix: String,
    )

    private fun fetchAuthStatus(serverUrl: String): AuthStatus? {
        return try {
            val connection = openGet("${serverUrl.trimEnd('/')}/api/auth/status")
            try {
                if (connection.responseCode !in 200..299) return null
                val body = readStream(connection.inputStream)
                val json = JSONObject(body)
                AuthStatus(
                    required = json.optBoolean("required", false),
                    authenticated = json.optBoolean("authenticated", false),
                    publicPrefix = json.optString("publicPrefix", ""),
                )
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun login(serverUrl: String, password: String): LoginResult {
        return try {
            val connection = openPost("$serverUrl/api/auth/login")
            try {
                OutputStreamWriter(connection.outputStream).use { writer ->
                    writer.write(JSONObject().put("password", password).toString())
                }

                val code = connection.responseCode
                val body = readStream(
                    if (code in 200..299) {
                        connection.inputStream
                    } else {
                        connection.errorStream ?: connection.inputStream
                    },
                )

                if (code !in 200..299) {
                    return LoginResult.Failure(parseErrorMessage(body) ?: "Invalid password")
                }

                val token = parseSessionToken(connection) ?: parseSessionTokenFromBody(body)
                    ?: return LoginResult.Failure("Sign-in succeeded but no session was returned")

                LoginResult.Success(token)
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            LoginResult.Failure("Network error. Check the address and try again.")
        }
    }

    private fun parseErrorMessage(body: String): String? {
        return try {
            JSONObject(body).optString("error", "").trim().ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    private fun parseSessionTokenFromBody(body: String): String? {
        return try {
            JSONObject(body).optString("token", "").trim().ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    private fun parseSessionToken(connection: HttpURLConnection): String? {
        val headerFields = connection.headerFields ?: return null
        for ((name, values) in headerFields) {
            if (!name.equals("Set-Cookie", ignoreCase = true)) continue
            for (value in values) {
                parseSessionFromCookieHeader(value)?.let { return it }
            }
        }

        return parseSessionFromCookieHeader(connection.getHeaderField("Set-Cookie"))
    }

    private fun parseSessionFromCookieHeader(setCookie: String?): String? {
        if (setCookie.isNullOrBlank()) return null

        for (part in setCookie.split(";")) {
            val trimmed = part.trim()
            for (prefix in listOf("media_session=", "reel_session=")) {
                if (!trimmed.startsWith(prefix)) continue
                val raw = trimmed.removePrefix(prefix).trim()
                if (raw.isEmpty() || raw == "deleted") continue
                return try {
                    URLDecoder.decode(raw, Charsets.UTF_8.name())
                } catch (_: Exception) {
                    raw
                }
            }
        }

        return null
    }

    private fun openGet(url: String): HttpURLConnection {
        return (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 8000
            requestMethod = "GET"
            instanceFollowRedirects = true
        }
    }

    private fun openPost(url: String): HttpURLConnection {
        return (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 8000
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            instanceFollowRedirects = true
        }
    }

    private fun readStream(stream: java.io.InputStream?): String {
        if (stream == null) return ""
        return BufferedReader(InputStreamReader(stream)).use { it.readText() }
    }

    fun logout(serverUrl: String, sessionToken: String?) {
        try {
            val connection = openPost("$serverUrl/api/auth/logout")
            if (!sessionToken.isNullOrBlank()) {
                connection.setRequestProperty(
                    "Cookie",
                    "media_session=$sessionToken; reel_session=$sessionToken",
                )
            }
            try {
                connection.responseCode
                readStream(
                    if (connection.responseCode in 200..299) {
                        connection.inputStream
                    } else {
                        connection.errorStream
                    },
                )
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            // Best-effort logout; local session is cleared regardless.
        }
    }

    fun saveProgress(
        serverUrl: String,
        sessionToken: String?,
        itemType: String,
        itemId: Int,
        positionMs: Long,
        durationMs: Long,
    ) {
        try {
            val connection = openPost("$serverUrl/api/watch-progress")
            if (!sessionToken.isNullOrBlank()) {
                connection.setRequestProperty(
                    "Cookie",
                    "media_session=$sessionToken; reel_session=$sessionToken",
                )
            }
            try {
                val body = JSONObject()
                    .put("itemType", itemType)
                    .put("itemId", itemId)
                    .put("positionMs", positionMs)
                    .put("durationMs", durationMs)
                OutputStreamWriter(connection.outputStream).use { writer ->
                    writer.write(body.toString())
                }
                connection.responseCode
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            // Best-effort progress save.
        }
    }

    fun getJson(url: String, sessionToken: String?): JSONObject? {
        return try {
            val connection = openGet(url)
            if (!sessionToken.isNullOrBlank()) {
                connection.setRequestProperty(
                    "Cookie",
                    "media_session=$sessionToken; reel_session=$sessionToken",
                )
            }
            try {
                if (connection.responseCode !in 200..299) return null
                JSONObject(readStream(connection.inputStream))
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }

    fun postJson(url: String, sessionToken: String?, body: String): Boolean {
        return try {
            val connection = openPost(url)
            if (!sessionToken.isNullOrBlank()) {
                connection.setRequestProperty(
                    "Cookie",
                    "media_session=$sessionToken; reel_session=$sessionToken",
                )
            }
            try {
                OutputStreamWriter(connection.outputStream).use { writer ->
                    writer.write(body)
                }
                connection.responseCode in 200..299
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            false
        }
    }
}
