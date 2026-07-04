package com.media.app

import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/** Injects session cookie on every HTTP request (manifest + HLS segments). */
class AuthenticatedHttpDataSourceFactory(
    private val sessionToken: String?,
) : HttpDataSource.Factory {
    private val upstream = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(20_000)
        .setReadTimeoutMs(20_000)
        .setUserAgent("MediaAndroidTV/1.1 ExoPlayer")

    override fun createDataSource(): HttpDataSource {
        val dataSource = upstream.createDataSource()
        if (!sessionToken.isNullOrBlank()) {
            dataSource.setRequestProperty(
                "Cookie",
                "media_session=$sessionToken; reel_session=$sessionToken",
            )
        }
        return dataSource
    }

    override fun setDefaultRequestProperties(
        defaultRequestProperties: MutableMap<String, String>,
    ): HttpDataSource.Factory {
        upstream.setDefaultRequestProperties(defaultRequestProperties)
        return this
    }
}

fun authenticatedMediaSourceFactory(sessionToken: String?): DefaultMediaSourceFactory {
    return DefaultMediaSourceFactory(AuthenticatedHttpDataSourceFactory(sessionToken))
}
