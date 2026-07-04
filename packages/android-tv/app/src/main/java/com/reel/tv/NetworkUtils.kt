package com.reel.tv

import java.net.Inet4Address
import java.net.NetworkInterface

object NetworkUtils {
    fun getLocalIpAddress(): String? {
        return try {
            NetworkInterface.getNetworkInterfaces()?.toList()?.flatMap { iface ->
                iface.inetAddresses.toList().mapNotNull { address ->
                    if (!address.isLoopbackAddress && address is Inet4Address) {
                        address.hostAddress
                    } else {
                        null
                    }
                }
            }?.firstOrNull()
        } catch (_: Exception) {
            null
        }
    }
}
