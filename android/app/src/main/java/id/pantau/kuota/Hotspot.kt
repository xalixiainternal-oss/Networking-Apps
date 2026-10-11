package id.pantau.kuota

import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections
import java.util.Locale

/**
 * Deteksi hotspot/tethering BEST EFFORT dari antarmuka jaringan yang sedang aktif.
 * Android tidak punya API publik untuk app biasa menanyakan "hotspot menyala?", jadi hasilnya perkiraan.
 */
object Hotspot {
    data class State(val active: Boolean, val kind: String, val iface: String?)

    private val WIFI_AP = Regex("^(ap\\d+|swlan\\d+|softap\\d+|wlan\\d+)$")
    private val USB = Regex("^(rndis\\d+|usb\\d+|ncm\\d+)$")
    private val BT = Regex("^bt-pan\\d*$")

    private fun isPrivateV4(a: String): Boolean {
        if (a.startsWith("192.168.") || a.startsWith("10.")) return true
        if (a.startsWith("172.")) {
            val second = a.split(".").getOrNull(1)?.toIntOrNull() ?: return false
            return second in 16..31
        }
        return false
    }

    fun detect(): State {
        var usb: State? = null
        var bt: State? = null
        try {
            val all = NetworkInterface.getNetworkInterfaces() ?: return State(false, "none", null)
            for (ni in Collections.list(all)) {
                if (!ni.isUp || ni.isLoopback) continue
                val name = ni.name.lowercase(Locale.ROOT)
                val v4 = Collections.list(ni.inetAddresses).filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
                if (v4.isEmpty()) continue
                // Access point punya alamat gateway (berakhiran .1) di jaringan privat; klien Wi-Fi biasa tidak.
                if (WIFI_AP.matches(name) && v4.any { it.endsWith(".1") && isPrivateV4(it) }) return State(true, "wifi", name)
                if (USB.matches(name)) usb = State(true, "usb", name)
                if (BT.matches(name)) bt = State(true, "bluetooth", name)
            }
        } catch (e: Exception) {
            return State(false, "none", null)
        }
        return usb ?: bt ?: State(false, "none", null)
    }
}
