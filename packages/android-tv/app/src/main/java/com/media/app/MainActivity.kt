package com.media.app

import android.annotation.SuppressLint
import android.app.SearchManager
import android.content.ComponentCallbacks2
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var webView: WebView
    private lateinit var nativePlayerView: PlayerView
    private lateinit var nativePlayer: NativePlayerManager
    private var serverUrl: String = ""
    private var keepScreenOn = false
    private var voiceSearchHelper: VoiceSearchHelper? = null
    private var tvCastPoller: TvCastPoller? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverUrl = intent.getStringExtra(EXTRA_SERVER_URL)
            ?: ServerPreferences.getServerUrl(this)
            ?: run {
                startActivity(Intent(this, SetupActivity::class.java))
                finish()
                return
            }

        webView = findViewById(R.id.webView)
        nativePlayerView = findViewById(R.id.nativePlayerView)
        nativePlayer = NativePlayerManager(nativePlayerView, emitJs = { script ->
            webView.post { webView.evaluateJavascript(script, null) }
        }) {
            runOnUiThread { setNativeVideoOverlayActive(false) }
        }

        configureWebView()
        configureBackNavigation()
        applySessionCookie()
        handleSearchIntent(intent)
        startTvCastPoller()
        webView.loadUrl(buildLaunchUrl(serverUrl))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleSearchIntent(intent)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.setBackgroundColor(Color.BLACK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.HONEYCOMB) {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = buildUserAgent(userAgentString)
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100
        }

        val bridge = MediaAndroidBridge()
        webView.addJavascriptInterface(bridge, "MediaAndroid")
        webView.addJavascriptInterface(bridge, "ReelAndroid")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                keepScreenOn = true
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                super.onShowCustomView(view, callback)
            }

            override fun onHideCustomView() {
                keepScreenOn = false
                updateKeepScreenOn()
                super.onHideCustomView()
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val target = request?.url ?: return false
                if (!request.isForMainFrame) return false

                val scheme = target.scheme?.lowercase()
                if (scheme != "http" && scheme != "https") {
                    return true
                }

                val host = target.host ?: return true
                val allowedHost = serverHost()
                return !host.equals(allowedHost, ignoreCase = true)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                if (request?.isForMainFrame == true) {
                    Toast.makeText(
                        this@MainActivity,
                        getString(R.string.connection_failed),
                        Toast.LENGTH_LONG,
                    ).show()
                }
            }
        }
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webView.evaluateJavascript(
                        """
                        (function() {
                          if (typeof window.__mediaWatchHandleBack === 'function') {
                            return window.__mediaWatchHandleBack();
                          }
                          return false;
                        })();
                        """.trimIndent(),
                    ) { result ->
                        runOnUiThread {
                            val consumed = result?.trim()?.equals("true", ignoreCase = true) == true
                            if (!consumed) {
                                performDefaultBackNavigation()
                            }
                        }
                    }
                }
            },
        )
    }

    private fun performDefaultBackNavigation() {
        when {
            nativePlayer.isActive() -> stopNativeVideoPlayback()
            webView.canGoBack() -> webView.goBack()
            else -> finishAffinity()
        }
    }

    private fun setNativeVideoOverlayActive(active: Boolean) {
        if (active) {
            webView.setBackgroundColor(Color.TRANSPARENT)
            webView.background = null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.HONEYCOMB) {
                // Hardware layers stay opaque on many Android TV WebViews and hide ExoPlayer below.
                webView.setLayerType(View.LAYER_TYPE_NONE, null)
            }
        } else {
            webView.setBackgroundColor(Color.BLACK)
            webView.alpha = 1f
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.HONEYCOMB) {
                webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
            }
        }
        webView.invalidate()
    }

    private fun stopNativeVideoPlayback() {
        nativePlayer.stop()
        setNativeVideoOverlayActive(false)
        updateKeepScreenOn()
    }

    private fun applySessionCookie() {
        CookieManager.getInstance().setAcceptCookie(true)
        val token = AuthSession.resolveSessionToken(this, serverUrl) ?: return
        val cookieManager = CookieManager.getInstance()
        cookieManager.setCookie(serverUrl, "media_session=$token")
        cookieManager.setCookie(serverUrl, "reel_session=$token")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.flush()
        }
    }

    private fun clearSessionCookie() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setCookie(serverUrl, "media_session=; Max-Age=0")
        cookieManager.setCookie(serverUrl, "reel_session=; Max-Age=0")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.flush()
        }
    }

    fun performLogout(reload: Boolean = true) {
        pauseAllPlayback()
        val sessionToken = SessionPreferences.getSessionToken(this)
        executor.execute {
            ServerConnector.logout(serverUrl, sessionToken)
            runOnUiThread {
                SessionPreferences.clearSessionToken(this)
                clearSessionCookie()
                if (reload) {
                    webView.loadUrl(buildLaunchUrl(serverUrl))
                }
            }
        }
    }

    private fun showAccountMenu() {
        AlertDialog.Builder(this)
            .setTitle(R.string.account_menu_title)
            .setItems(
                arrayOf(
                    getString(R.string.log_out),
                    getString(R.string.change_server),
                ),
            ) { _, which ->
                when (which) {
                    0 -> performLogout()
                    1 -> openSetup(resetServer = true)
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun buildLaunchUrl(baseUrl: String): String {
        val trimmed = baseUrl.trimEnd('/')
        return "$trimmed/?tv=1"
    }

    private fun buildUserAgent(defaultAgent: String): String {
        return if (defaultAgent.contains(USER_AGENT_TOKEN)) {
            defaultAgent
        } else {
            "$defaultAgent $USER_AGENT_TOKEN/1.0"
        }
    }

    private fun serverHost(): String {
        return try {
            java.net.URI(serverUrl).host ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    private fun pauseAllPlayback() {
        if (nativePlayer.isActive()) {
            nativePlayer.pause()
        }
        pauseWebPlayback()
        updateKeepScreenOn()
    }

    private fun pauseWebPlayback() {
        webView.evaluateJavascript(PAUSE_WEB_PLAYBACK_JS, null)
    }

    private fun dispatchMediaKeyToWeb(keyCode: Int) {
        val key =
            when (keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY -> "MediaPlay"
                KeyEvent.KEYCODE_MEDIA_PAUSE -> "MediaPause"
                else -> "MediaPlayPause"
            }
        webView.evaluateJavascript(
            """
            (function(){
              window.dispatchEvent(new KeyboardEvent('keydown', { key: '$key', bubbles: true }));
            })();
            """.trimIndent(),
            null,
        )
    }

    private fun updateKeepScreenOn() {
        val shouldKeepOn = keepScreenOn || nativePlayer.isPlaying()
        if (shouldKeepOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (nativePlayer.isActive()) {
            nativePlayer.syncPlaybackState()
        }
    }

    override fun onPause() {
        pauseAllPlayback()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        voiceSearchHelper?.release()
        tvCastPoller?.shutdown()
        executor.shutdownNow()
        nativePlayer.release()
        webView.destroy()
        super.onDestroy()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW && ::webView.isInitialized) {
            webView.clearCache(true)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY,
                KeyEvent.KEYCODE_MEDIA_PAUSE,
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                    dispatchMediaKeyToWeb(event.keyCode)
                    return true
                }
                KeyEvent.KEYCODE_SEARCH -> {
                    startVoiceSearch()
                    return true
                }
            }
        }

        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            showAccountMenu()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun openSetup(resetServer: Boolean) {
        stopNativeVideoPlayback()
        if (resetServer) {
            ServerPreferences.clearServerUrl(this)
        }
        startActivity(Intent(this, SetupActivity::class.java))
        finish()
    }

    private fun handleSearchIntent(intent: Intent?) {
        val query = intent?.getStringExtra(SearchManager.QUERY)
        if (!query.isNullOrBlank()) {
            navigateToSearch(query)
        }
    }

    private fun navigateToSearch(query: String) {
        val encoded = URLEncoder.encode(query.trim(), Charsets.UTF_8.name())
        val base = serverUrl.trimEnd('/')
        webView.loadUrl("$base/search/?tv=1&q=$encoded")
    }

    private fun startVoiceSearch() {
        voiceSearchHelper?.release()
        voiceSearchHelper =
            VoiceSearchHelper(
                this,
                onResult = { query -> runOnUiThread { navigateToSearch(query) } },
                onError = {
                    runOnUiThread {
                        Toast.makeText(
                            this,
                            R.string.voice_search_failed,
                            Toast.LENGTH_SHORT,
                        ).show()
                    }
                },
            )
        voiceSearchHelper?.start()
    }

    private fun startTvCastPoller() {
        tvCastPoller?.shutdown()
        tvCastPoller =
            TvCastPoller(
                serverUrl = serverUrl.trimEnd('/'),
                sessionTokenProvider = {
                    AuthSession.resolveSessionToken(this, serverUrl)
                },
                onCast = { pending ->
                    runOnUiThread { handleTvCast(pending) }
                },
            )
        tvCastPoller?.start()
    }

    private fun handleTvCast(pending: JSONObject) {
        val type = pending.optString("type")
        val fileId = pending.optInt("fileId", 0)
        if (fileId <= 0 || (type != "movie" && type != "episode")) return

        val mediaId = pending.optInt("mediaId", 0)
        val startMs = pending.optLong("startTimeMs", 0L)
        val params =
            buildString {
                append("type=$type&id=$fileId&tv=1")
                if (mediaId > 0) append("&media=$mediaId")
                if (startMs > 0) append("&start=${startMs / 1000}")
            }

        stopNativeVideoPlayback()
        webView.loadUrl("${serverUrl.trimEnd('/')}/watch/?$params")
    }

    private inner class MediaAndroidBridge {
        @JavascriptInterface
        fun logout() {
            runOnUiThread {
                performLogout(reload = true)
            }
        }

        @JavascriptInterface
        fun prepareNativeVideo() {
            runOnUiThread { setNativeVideoOverlayActive(true) }
        }

        @JavascriptInterface
        fun play(payload: String) {
            runOnUiThread {
                val sessionToken = AuthSession.resolveSessionToken(this@MainActivity, serverUrl)
                if (sessionToken.isNullOrBlank()) {
                    Toast.makeText(
                        this@MainActivity,
                        R.string.playback_auth_required,
                        Toast.LENGTH_LONG,
                    ).show()
                    webView.evaluateJavascript("window.__mediaNativePlayer?.onError?.()", null)
                    return@runOnUiThread
                }

                val parsed = PlaybackPayload.parse(payload)
                if (parsed == null) {
                    webView.evaluateJavascript("window.__mediaNativePlayer?.onError?.()", null)
                    return@runOnUiThread
                }

                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                setNativeVideoOverlayActive(true)
                nativePlayer.play(serverUrl, sessionToken, parsed)
            }
        }

        @JavascriptInterface
        fun pause() {
            runOnUiThread {
                nativePlayer.pause()
                updateKeepScreenOn()
            }
        }

        @JavascriptInterface
        fun resume() {
            runOnUiThread {
                nativePlayer.resume()
                updateKeepScreenOn()
            }
        }

        @JavascriptInterface
        fun seekTo(positionMs: Double) {
            runOnUiThread { nativePlayer.seekTo(positionMs.toLong()) }
        }

        @JavascriptInterface
        fun stop() {
            runOnUiThread { stopNativeVideoPlayback() }
        }

        @JavascriptInterface
        fun setVideoDisplayMode(mode: String) {
            runOnUiThread { nativePlayer.setDisplayMode(mode) }
        }

        @JavascriptInterface
        fun syncPlaybackState() {
            runOnUiThread { nativePlayer.syncPlaybackState() }
        }

        @JavascriptInterface
        fun setWebOverlayAlpha(alpha: Double) {
            runOnUiThread {
                webView.alpha = alpha.toFloat().coerceIn(0f, 1f)
            }
        }
    }

    companion object {
        const val EXTRA_SERVER_URL = "server_url"
        private const val USER_AGENT_TOKEN = "MediaAndroidTV"
        private const val PAUSE_WEB_PLAYBACK_JS =
            "(function(){var video=document.querySelector('video');if(video&&!video.paused){video.pause();}})();"
    }
}
