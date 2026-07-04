package com.reel.tv

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import fi.iki.elonen.NanoHTTPD
import java.util.concurrent.Executors

class SetupActivity : AppCompatActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var hostInput: EditText
    private lateinit var portInput: EditText
    private lateinit var statusText: TextView
    private lateinit var connectButton: Button
    private lateinit var qrCodeImage: ImageView
    private lateinit var pairingUrlText: TextView
    private lateinit var pairingStatusText: TextView

    private var pairingServer: PairingServer? = null
    private var pairingToken: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        ServerPreferences.getServerUrl(this)?.let { savedUrl ->
            startMainActivity(savedUrl)
            return
        }

        setContentView(R.layout.activity_setup)

        hostInput = findViewById(R.id.hostInput)
        portInput = findViewById(R.id.portInput)
        statusText = findViewById(R.id.statusText)
        connectButton = findViewById(R.id.connectButton)
        qrCodeImage = findViewById(R.id.qrCodeImage)
        pairingUrlText = findViewById(R.id.pairingUrlText)
        pairingStatusText = findViewById(R.id.pairingStatusText)

        connectButton.setOnClickListener { attemptManualConnect() }
        hostInput.setOnEditorActionListener { _, _, _ ->
            attemptManualConnect()
            true
        }
        portInput.setOnEditorActionListener { _, _, _ ->
            attemptManualConnect()
            true
        }

        startPairingServer()
        hostInput.requestFocus()
    }

    override fun onDestroy() {
        stopPairingServer()
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun startPairingServer() {
        pairingToken = PairingServer.createToken()
        val localIp = NetworkUtils.getLocalIpAddress()

        if (localIp == null) {
            pairingStatusText.setText(R.string.pairing_unavailable)
            qrCodeImage.setImageDrawable(null)
            return
        }

        val pairingUrl = "http://$localIp:${PairingServer.PORT}/?token=$pairingToken"
        pairingUrlText.text = pairingUrl
        QrCodeGenerator.create(pairingUrl, 512)?.let { qrCodeImage.setImageBitmap(it) }

        pairingServer = PairingServer(
            port = PairingServer.PORT,
            context = applicationContext,
            pairingToken = pairingToken,
            onPaired = { result, serverUrl ->
                runOnUiThread {
                    completeConnection(serverUrl, result.sessionToken, fromPairing = true)
                }
            },
        )

        try {
            pairingServer?.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            pairingStatusText.setText(R.string.pairing_waiting)
        } catch (_: Exception) {
            pairingStatusText.setText(R.string.pairing_unavailable)
        }
    }

    private fun stopPairingServer() {
        pairingServer?.stop()
        pairingServer = null
    }

    private fun attemptManualConnect() {
        val serverUrl = ServerPreferences.normalizeServerUrl(
            hostInput.text.toString(),
            portInput.text.toString(),
        )

        if (serverUrl == null) {
            statusText.setText(R.string.invalid_host)
            return
        }

        setManualConnecting(true)
        statusText.text = getString(R.string.connecting)

        executor.execute {
            val result = ServerConnector.connect(serverUrl, password = null)
            runOnUiThread {
                setManualConnecting(false)
                if (result.success) {
                    completeConnection(serverUrl, result.sessionToken, fromPairing = false)
                } else if (result.passwordRequired) {
                    statusText.setTextColor(ContextCompat.getColor(this, R.color.reel_error))
                    statusText.text = getString(R.string.password_use_phone)
                } else {
                    statusText.setTextColor(ContextCompat.getColor(this, R.color.reel_error))
                    statusText.text = getString(R.string.connection_failed)
                }
            }
        }
    }

    private fun completeConnection(
        serverUrl: String,
        sessionToken: String?,
        fromPairing: Boolean,
    ) {
        ServerPreferences.saveServerUrl(this, serverUrl)
        SessionPreferences.saveSessionToken(this, sessionToken)

        if (fromPairing) {
            pairingStatusText.setTextColor(ContextCompat.getColor(this, R.color.reel_primary))
            pairingStatusText.setText(R.string.connected)
        } else {
            statusText.setTextColor(ContextCompat.getColor(this, R.color.reel_primary))
            statusText.setText(R.string.connected)
        }

        stopPairingServer()
        startMainActivity(serverUrl)
    }

    private fun setManualConnecting(connecting: Boolean) {
        connectButton.isEnabled = !connecting
        hostInput.isEnabled = !connecting
        portInput.isEnabled = !connecting
        connectButton.text = if (connecting) {
            getString(R.string.connecting)
        } else {
            getString(R.string.connect)
        }
    }

    private fun startMainActivity(serverUrl: String) {
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_SERVER_URL, serverUrl)
        }
        startActivity(intent)
        finish()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            finishAffinity()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
