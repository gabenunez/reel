package com.reel.tv

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.util.UUID

class PairingServer(
    port: Int,
    private val context: Context,
    private val pairingToken: String,
    private val onPaired: (ConnectResult, String) -> Unit,
) : NanoHTTPD(port) {

    override fun serve(session: IHTTPSession): Response {
        return when {
            session.method == Method.GET && session.uri == "/" -> servePairPage()
            session.method == Method.GET && session.uri == "/pair.css" -> serveAsset("pair.css", "text/css")
            session.method == Method.POST && session.uri == "/api/connect" -> handleConnect(session)
            else -> newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found")
        }
    }

    private fun servePairPage(): Response {
        val html = context.assets.open("pair.html").bufferedReader().use { it.readText() }
        return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html)
    }

    private fun serveAsset(name: String, mime: String): Response {
        return try {
            val content = context.assets.open(name).bufferedReader().use { it.readText() }
            newFixedLengthResponse(Response.Status.OK, mime, content)
        } catch (_: Exception) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found")
        }
    }

    private fun handleConnect(session: IHTTPSession): Response {
        return try {
            val body = readPostBody(session)
            val json = JSONObject(body)

            val token = json.optString("token", "")
            if (token != pairingToken) {
                return jsonResponse(
                    Response.Status.UNAUTHORIZED,
                    JSONObject().put("error", "Invalid pairing session"),
                )
            }

            val serverUrl = ServerPreferences.normalizeServerUrl(
                json.optString("host", ""),
                json.optString("port", ""),
            ) ?: return jsonResponse(
                Response.Status.BAD_REQUEST,
                JSONObject().put("error", "Enter a server address"),
            )

            val password = json.optString("password", "").trim().ifEmpty { null }
            val result = ServerConnector.connect(serverUrl, password)

            if (!result.success) {
                return jsonResponse(
                    Response.Status.BAD_REQUEST,
                    JSONObject().put("error", result.error ?: "Connection failed"),
                )
            }

            onPaired(result, serverUrl)

            jsonResponse(
                Response.Status.OK,
                JSONObject().put("success", true),
            )
        } catch (_: Exception) {
            jsonResponse(
                Response.Status.BAD_REQUEST,
                JSONObject().put("error", "Invalid request"),
            )
        }
    }

    private fun readPostBody(session: IHTTPSession): String {
        val files = HashMap<String, String>()
        session.parseBody(files)
        return files["postData"] ?: ""
    }

    private fun jsonResponse(status: Response.Status, json: JSONObject): Response {
        return newFixedLengthResponse(status, "application/json", json.toString())
    }

    companion object {
        const val PORT = 8765

        fun createToken(): String = UUID.randomUUID().toString().replace("-", "")
    }
}
