package id.pantau.kuota

// PrankPlugin.kt — Capacitor bridge untuk WiFi Prank.
// Expose ke JS: startPrank, stopPrank, getPrankState, unblockClient, downloadFoto
// Language: Kotlin | Capacitor 6 | Target: API 26+

import android.content.Context
import android.net.ConnectivityManager
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

@CapacitorPlugin(name = "PrankPlugin")
class PrankPlugin : Plugin() {

    private val io = CoroutineScope(Dispatchers.IO)
    @Volatile private var server: PrankServer? = null
    @Volatile private var gatewayIp: String = "192.168.43.1"

    companion object {
        private const val TAG = "PrankPlugin"
        const val EVENT_CLIENT = "prankClient"
    }

    // ── startPrank ──────────────────────────────────────────────────────────
    // JS: await PrankPlugin.startPrank({ config: {...}, fotoUrl: "..." })
    // Langkah: 1) download foto  2) start HTTP server  3) apply iptables  4) start hotspot

    @PluginMethod
    fun startPrank(call: PluginCall) {
        if (server?.isRunning == true) {
            call.resolve(JSObject().put("ok", true).put("message", "Sudah berjalan."))
            return
        }

        val cfg   = call.getObject("config") ?: JSObject()
        val fotoUrl = call.getString("fotoUrl") ?: ""

        io.launch {
            try {
                // 1. detect gateway IP dari adapter hotspot
                val ip = detectGatewayIp(context) ?: "192.168.43.1"
                gatewayIp = ip
                Log.i(TAG, "gateway IP: $ip")

                // 2. download foto (opsional)
                val (fotoBytes, fotoMime) = if (fotoUrl.isNotEmpty()) downloadFoto(fotoUrl)
                                             else Pair(null, "image/jpeg")

                // 3. buat config server
                val serverCfg = PrankServerConfig(
                    pageTitle     = cfg.getString("pageTitle")     ?: "WiFi Gratis",
                    pageSubtitle  = cfg.getString("pageSubtitle")  ?: "Tekan tombol di bawah untuk mulai memakai internet.",
                    btnLabel      = cfg.getString("btnLabel")      ?: "Masuk",
                    connectingMsg = cfg.getString("connectingMsg") ?: "Menyambungkan internet...",
                    theme         = cfg.getString("theme")         ?: "red",
                    fotoBytes     = fotoBytes,
                    fotoMime      = fotoMime,
                )

                // 4. start HTTP server
                val srv = PrankServer(
                    gatewayIp     = ip,
                    config        = serverCfg,
                    onClientEvent = { client -> emitClientEvent(client) },
                )
                srv.start()
                server = srv
                Log.i(TAG, "PrankServer started on :${PrankServer.HTTP_PORT}")

                // 5. cek root dulu sebelum apply iptables
                val isRooted = checkRoot()
                var iptablesOk = false
                if (isRooted) {
                    val iptResult = PrankIptables.apply(ip)
                    iptablesOk = iptResult.isSuccess
                    if (!iptablesOk) {
                        Log.w(TAG, "iptables partial fail: ${iptResult.exceptionOrNull()?.message}")
                    }
                } else {
                    Log.i(TAG, "HP tidak root — skip iptables, server jalan di port ${PrankServer.HTTP_PORT}")
                }

                // 6. start hotspot via Shizuku (best-effort)
                startHotspotViaShizuku()

                val accessUrl = if (iptablesOk) "http://$ip/" else "http://$ip:${PrankServer.HTTP_PORT}/"
                call.resolve(JSObject()
                    .put("ok", true)
                    .put("gatewayIp", ip)
                    .put("accessUrl", accessUrl)
                    .put("rooted", isRooted)
                    .put("iptablesOk", iptablesOk)
                    .put("message", if (iptablesOk)
                        "Prank aktif (auto-redirect ON) — $accessUrl"
                    else
                        "Prank aktif (no redirect) — bagikan URL: $accessUrl"
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "startPrank error", e)
                call.reject("Gagal memulai prank: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    // ── stopPrank ───────────────────────────────────────────────────────────

    @PluginMethod
    fun stopPrank(call: PluginCall) {
        io.launch {
            try {
                server?.stop()
                server = null
                PrankIptables.flush()
                // stop hotspot
                ShizukuServiceClient.execute(ShellOperation.STOP_HOTSPOT)
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                Log.e(TAG, "stopPrank error", e)
                call.reject("Gagal menghentikan prank: ${e.message}")
            }
        }
    }

    // ── getPrankState ────────────────────────────────────────────────────────

    @PluginMethod
    fun getPrankState(call: PluginCall) {
        val srv = server
        val running = srv?.isRunning == true
        val arr = JSArray()
        srv?.clients?.values?.forEach { c ->
            arr.put(JSObject()
                .put("ip", c.ip)
                .put("mac", c.mac)
                .put("connectedAt", c.connectedAt)
                .put("loggedIn", c.loggedIn)
                .put("loginAt", c.loginAt)
            )
        }
        call.resolve(JSObject()
            .put("running", running)
            .put("gatewayIp", gatewayIp)
            .put("clients", arr)
            .put("authorizedCount", srv?.authorized?.size ?: 0)
        )
    }

    // ── unblockClient — paksa unblock tanpa harus klik Masuk ────────────────

    @PluginMethod
    fun unblockClient(call: PluginCall) {
        val ip = call.getString("ip") ?: run { call.reject("ip diperlukan"); return }
        io.launch {
            try {
                server?.authorized?.add(ip)
                PrankIptables.unblockIp(ip)
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject("unblock gagal: ${e.message}")
            }
        }
    }

    // ── blockClient — re-block (reset sesi) ─────────────────────────────────

    @PluginMethod
    fun blockClient(call: PluginCall) {
        val ip = call.getString("ip") ?: run { call.reject("ip diperlukan"); return }
        io.launch {
            try {
                server?.authorized?.remove(ip)
                PrankIptables.blockIp(ip)
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject("block gagal: ${e.message}")
            }
        }
    }

    // ── updateFoto — ganti foto saat prank sedang jalan ─────────────────────

    @PluginMethod
    fun updateFoto(call: PluginCall) {
        val url = call.getString("fotoUrl") ?: run { call.reject("fotoUrl diperlukan"); return }
        io.launch {
            try {
                val (bytes, mime) = downloadFoto(url)
                // rebuild server dengan foto baru
                val srv = server ?: run { call.reject("Prank belum jalan"); return@launch }
                val newCfg = srv.config.copy(fotoBytes = bytes, fotoMime = mime)
                // restart server dengan config baru tanpa flush iptables
                srv.stop()
                val newSrv = PrankServer(gatewayIp, newCfg, ::emitClientEvent)
                newSrv.authorized.addAll(srv.authorized)
                newSrv.clients.putAll(srv.clients)
                newSrv.start()
                server = newSrv
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject("updateFoto gagal: ${e.message}")
            }
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private fun emitClientEvent(client: PrankClient) {
        try {
            notifyListeners(EVENT_CLIENT, JSObject()
                .put("ip", client.ip)
                .put("mac", client.mac)
                .put("connectedAt", client.connectedAt)
                .put("loggedIn", client.loggedIn)
                .put("loginAt", client.loginAt)
            )
        } catch (e: Exception) {
            Log.w(TAG, "emitClientEvent error", e)
        }
    }

    private fun checkRoot(): Boolean {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("su", "-c", "id"))
            val out = p.inputStream.bufferedReader().readText()
            p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
            "uid=0" in out
        } catch (e: Exception) {
            false
        }
    }

    private fun detectGatewayIp(ctx: Context): String? {
        val st = Hotspot.detect(ctx)
        if (st.active && st.iface != null) {
            // ambil IPv4 dari interface hotspot
            try {
                val ni = java.net.NetworkInterface.getByName(st.iface) ?: return null
                for (addr in java.util.Collections.list(ni.inetAddresses)) {
                    if (addr is java.net.Inet4Address && !addr.isLoopbackAddress)
                        return addr.hostAddress
                }
            } catch (e: Exception) { /* */ }
        }
        // fallback umum
        return "192.168.43.1"
    }

    private suspend fun downloadFoto(url: String): Pair<ByteArray?, String> =
        withContext(Dispatchers.IO) {
            try {
                val conn = URL(url).openConnection()
                // trust all untuk self-signed (foto endpoint)
                if (conn is HttpsURLConnection) {
                    val tm = arrayOf<TrustManager>(object : X509TrustManager {
                        override fun checkClientTrusted(c: Array<out java.security.cert.X509Certificate>?, a: String?) {}
                        override fun checkServerTrusted(c: Array<out java.security.cert.X509Certificate>?, a: String?) {}
                        override fun getAcceptedIssuers() = emptyArray<java.security.cert.X509Certificate>()
                    })
                    val sc = SSLContext.getInstance("TLS")
                    sc.init(null, tm, java.security.SecureRandom())
                    conn.sslSocketFactory = sc.socketFactory
                    conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
                }
                conn.connectTimeout = 15_000
                conn.readTimeout    = 20_000
                conn.setRequestProperty("User-Agent", "Mozilla/5.0")
                val mime  = conn.contentType?.split(";")?.firstOrNull()?.trim() ?: "image/jpeg"
                val bytes = conn.getInputStream().use { it.readBytes() }
                Pair(bytes, mime)
            } catch (e: Exception) {
                Log.w(TAG, "downloadFoto($url) gagal: ${e.message}")
                Pair(null, "image/jpeg")
            }
        }

    private suspend fun startHotspotViaShizuku() {
        // Android 11+: cmd wifi start-softap
        val r = ShizukuServiceClient.execute(ShellOperation.START_HOTSPOT)
        if (!r.ok) Log.w(TAG, "start-softap: ${r.error}")
        // tunggu sebentar agar hotspot naik
        kotlinx.coroutines.delay(2_000)
    }
}
