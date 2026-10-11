package id.pantau.kuota

import android.content.Context
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections
import java.util.Locale

/**
 * Deteksi hotspot/tethering BEST EFFORT. Android tidak punya API publik untuk app biasa menanyakan
 * "hotspot menyala?", jadi beberapa sinyal digabung:
 *  1. antarmuka jaringan privat berakhiran .1 yang BUKAN jaringan klien (Wi-Fi/seluler) milik HP ini,
 *  2. WifiManager.isWifiApEnabled() lewat refleksi (tidak ada di semua versi/vendor),
 *  3. antarmuka USB (rndis/ncm) dan Bluetooth PAN.
 * `debug` berisi daftar antarmuka yang terbaca, untuk diagnosis di layar.
 */
object Hotspot {
    data class State(val active: Boolean, val kind: String, val iface: String?, val debug: String = "")

    private val USB = Regex("^(rndis\\d+|usb\\d+|ncm\\d+)$")
    private val BT = Regex("^bt-pan\\d*$")
    // Antarmuka yang jelas bukan access point: seluler, VPN, loopback, virtual.
    private val NOT_AP = Regex("^(lo|rmnet.*|r_rmnet.*|ccmni.*|v4-.*|clat.*|tun\\d*|tap\\d*|dummy.*|ifb.*|tunl.*|sit\\d*|ip6.*|p2p.*|wwan.*|ppp.*|ipsec.*)$")

    private fun isPrivateV4(a: String): Boolean {
        if (a.startsWith("192.168.") || a.startsWith("10.")) return true
        if (a.startsWith("172.")) {
            val second = a.split(".").getOrNull(1)?.toIntOrNull() ?: return false
            return second in 16..31
        }
        return false
    }

    /** Nama antarmuka jaringan yang dipakai HP ini sebagai KLIEN (Wi-Fi yang tersambung, seluler, VPN). */
    @Suppress("DEPRECATION")
    private fun clientInterfaces(context: Context): Set<String> {
        val out = HashSet<String>()
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return out
            for (n in cm.allNetworks) {
                val name = cm.getLinkProperties(n)?.interfaceName
                if (name != null) out.add(name.lowercase(Locale.ROOT))
            }
        } catch (e: Exception) {
            // abaikan: tanpa daftar klien, deteksi tetap jalan dengan filter nama saja
        }
        return out
    }

    /** Refleksi: sebagian perangkat masih mengizinkan, sebagian menolak. null = tidak diketahui. */
    private fun wifiApEnabled(context: Context): Boolean? {
        return try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val m = WifiManager::class.java.getDeclaredMethod("isWifiApEnabled")
            m.isAccessible = true
            m.invoke(wm) as? Boolean
        } catch (e: Throwable) {
            null
        }
    }

    fun detect(context: Context): State {
        val seen = ArrayList<String>()
        var ap: State? = null
        var usb: State? = null
        var bt: State? = null
        try {
            val clients = clientInterfaces(context)
            val all = NetworkInterface.getNetworkInterfaces()
            if (all != null) {
                for (ni in Collections.list(all)) {
                    val name = ni.name.lowercase(Locale.ROOT)
                    val v4 = Collections.list(ni.inetAddresses).filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
                    val up = ni.isUp
                    if (ni.isLoopback) continue
                    seen.add(name + (if (up) "" else "(mati)") + (if (v4.isEmpty()) "" else "=" + v4.joinToString("/")))
                    if (!up || v4.isEmpty()) continue
                    if (USB.matches(name)) { usb = State(true, "usb", name); continue }
                    if (BT.matches(name)) { bt = State(true, "bluetooth", name); continue }
                    if (name in clients || NOT_AP.matches(name)) continue
                    // Access point punya alamat gateway (berakhiran .1) di jaringan privat; klien biasa tidak.
                    if (ap == null && v4.any { it.endsWith(".1") && isPrivateV4(it) }) ap = State(true, "wifi", name)
                }
            }
        } catch (e: Exception) {
            // lanjut ke sinyal berikutnya
        }
        val debug = seen.joinToString(", ")
        ap?.let { return it.copy(debug = debug) }
        if (wifiApEnabled(context) == true) return State(true, "wifi", null, debug)
        usb?.let { return it.copy(debug = debug) }
        bt?.let { return it.copy(debug = debug) }
        return State(false, "none", null, debug)
    }
}
