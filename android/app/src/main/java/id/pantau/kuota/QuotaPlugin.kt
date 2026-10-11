package id.pantau.kuota

import android.Manifest
import android.app.AppOpsManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.VpnService
import android.net.TrafficStats
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import androidx.activity.result.ActivityResult
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.PermissionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

@CapacitorPlugin(
    name = "Quota",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notif")]
)
class QuotaPlugin : Plugin() {
    private val io = CoroutineScope(Dispatchers.IO)

    // ─── helpers izin ─────────────────────────────────────────────────────
    private fun hasUsageAccess(): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= 29)
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        else @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun notificationsGranted(): Boolean =
        if (Build.VERSION.SDK_INT >= 33) getPermissionState("notif") == PermissionState.GRANTED else true

    private fun batteryIgnored(): Boolean =
        context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

    // ─── izin ─────────────────────────────────────────────────────────────
    @PluginMethod
    fun getPermissionStatus(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("usageAccess", hasUsageAccess())
            put("notifications", notificationsGranted())
            put("batteryOptimizationIgnored", batteryIgnored())
        })
    }

    @PluginMethod
    fun openUsageAccessSettings(call: PluginCall) {
        val i = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(Intent(i).setData(Uri.parse("package:${context.packageName}"))) }
        catch (e: Exception) { try { context.startActivity(i) } catch (e: Exception) { call.reject("Tidak bisa membuka pengaturan Akses Penggunaan."); return } }
        call.resolve()
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (notificationsGranted()) { call.resolve(JSObject().put("granted", true)); return }
        requestPermissionForAlias("notif", call, "notifCallback")
    }

    @PermissionCallback
    private fun notifCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", notificationsGranted()))
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        try {
            context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (e: Exception) { call.reject("Pengaturan baterai tidak tersedia di perangkat ini.") }
    }

    // ─── tracking & sync ──────────────────────────────────────────────────
    @PluginMethod
    fun startTracking(call: PluginCall) {
        UsageWorker.schedule(context)
        UsageWorker.runOnce(context)      // data pertama muncul tanpa menunggu jadwal 1 jam
        applyServiceState()
        BlockerVpnService.ensure(context)
        call.resolve()
    }

    @PluginMethod
    fun syncNow(call: PluginCall) {
        io.launch {
            val r = try { UsageSync.sync(context) } catch (e: Exception) {
                SyncResult(false, 0, UsageSync.mobileSupported(), e.message)
            }
            call.resolve(JSObject().put("ok", r.ok).put("rows", r.rows)
                .put("mobileSupported", r.mobileSupported).put("sdk", Build.VERSION.SDK_INT)
                .put("message", r.message))
        }
    }

    /** Sinkron data per-aplikasi (lebih berat, dipanggil dari tab Aplikasi). */
    @PluginMethod
    fun syncAppsNow(call: PluginCall) {
        io.launch {
            val r = try { UsageSync.syncApps(context) } catch (e: Exception) {
                SyncResult(false, 0, UsageSync.mobileSupported(), e.message)
            }
            call.resolve(JSObject().put("ok", r.ok).put("rows", r.rows)
                .put("mobileSupported", r.mobileSupported).put("sdk", Build.VERSION.SDK_INT)
                .put("message", r.message))
        }
    }

    // ─── baca data total ──────────────────────────────────────────────────
    @PluginMethod
    fun getHours(call: PluginCall) {
        val from = call.getLong("from") ?: 0L
        val to   = call.getLong("to")   ?: System.currentTimeMillis()
        io.launch {
            val arr = JSONArray()
            UsageDb.get(context).dao().range(from, to).forEach {
                arr.put(JSONObject().put("t", it.hourStart).put("net", it.net).put("rx", it.rx).put("tx", it.tx))
            }
            call.resolve(JSObject().put("rows", arr))
        }
    }

    /** Total semua antarmuka sejak boot. Untuk kecepatan real-time di UI. */
    @PluginMethod
    fun getTrafficTotals(call: PluginCall) {
        val rx = TrafficStats.getTotalRxBytes(); val tx = TrafficStats.getTotalTxBytes()
        if (rx == TrafficStats.UNSUPPORTED.toLong()) { call.reject("TrafficStats tidak didukung di perangkat ini."); return }
        call.resolve(JSObject().put("rx", rx).put("tx", tx))
    }

    // ─── baca data per-aplikasi ───────────────────────────────────────────
    /**
     * Mengembalikan ringkasan total tiap UID dalam rentang.
     * Setiap item: { uid, rx, tx, rxCell, txCell, rxWifi, txWifi }
     */
    @PluginMethod
    fun getAppSummary(call: PluginCall) {
        val from = call.getLong("from") ?: 0L
        val to   = call.getLong("to")   ?: System.currentTimeMillis()
        io.launch {
            val dao  = UsageDb.get(context).dao()
            val rows = dao.appSummary(from, to)
            // kelompokkan per uid
            data class Acc(var rxCell: Long = 0, var txCell: Long = 0, var rxWifi: Long = 0, var txWifi: Long = 0)
            val map = mutableMapOf<Int, Acc>()
            for (r in rows) {
                val a = map.getOrPut(r.uid) { Acc() }
                if (r.net == "cell") { a.rxCell += r.rx; a.txCell += r.tx }
                else                 { a.rxWifi += r.rx; a.txWifi += r.tx }
            }
            val arr = JSONArray()
            map.forEach { (uid, a) ->
                arr.put(JSONObject()
                    .put("uid", uid)
                    .put("rx", a.rxCell + a.rxWifi)
                    .put("tx", a.txCell + a.txWifi)
                    .put("rxCell", a.rxCell).put("txCell", a.txCell)
                    .put("rxWifi", a.rxWifi).put("txWifi", a.txWifi))
            }
            call.resolve(JSObject().put("rows", arr))
        }
    }

    /** Deret jam untuk satu UID (untuk grafik detail aplikasi). */
    @PluginMethod
    fun getAppHours(call: PluginCall) {
        val uid  = call.getInt("uid")   ?: run { call.reject("uid diperlukan"); return }
        val from = call.getLong("from") ?: 0L
        val to   = call.getLong("to")   ?: System.currentTimeMillis()
        io.launch {
            val arr = JSONArray()
            UsageDb.get(context).dao().appHours(uid, from, to).forEach {
                arr.put(JSONObject().put("uid", it.uid).put("t", it.hourStart)
                    .put("net", it.net).put("rx", it.rx).put("tx", it.tx).put("isFg", it.isFg))
            }
            call.resolve(JSObject().put("rows", arr))
        }
    }

    /** Cache info aplikasi: nama, paket, isSystem. */
    @PluginMethod
    fun getAppInfoList(call: PluginCall) {
        io.launch {
            val arr = JSONArray()
            UsageDb.get(context).dao().allInfo().forEach {
                arr.put(JSONObject().put("uid", it.uid).put("packageName", it.packageName)
                    .put("label", it.label).put("isSystem", it.isSystem))
            }
            call.resolve(JSObject().put("rows", arr))
        }
    }

    /**
     * Ambil ikon satu aplikasi sebagai PNG base64 (48dp → 192×192 px @ xxhdpi).
     * Dipanggil lazy dari JS saat ikon masuk viewport.
     */
    @PluginMethod
    fun getAppIcon(call: PluginCall) {
        val pkg = call.getString("packageName") ?: run { call.reject("packageName diperlukan"); return }
        io.launch {
            try {
                val pm  = context.packageManager
                val d   = pm.getApplicationIcon(pkg)
                val bmp = if (d is BitmapDrawable && d.bitmap != null) {
                    d.bitmap
                } else {
                    val b = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888)
                    Canvas(b).also { d.setBounds(0, 0, 192, 192); d.draw(it) }
                    b
                }
                val scaled = Bitmap.createScaledBitmap(bmp, 192, 192, true)
                val bos = ByteArrayOutputStream()
                scaled.compress(Bitmap.CompressFormat.PNG, 90, bos)
                val b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
                call.resolve(JSObject().put("base64", "data:image/png;base64,$b64"))
            } catch (e: Exception) {
                call.resolve(JSObject().put("base64", ""))
            }
        }
    }

    /** Buka halaman Info Aplikasi sistem untuk packageName tertentu. */
    @PluginMethod
    fun openAppInfo(call: PluginCall) {
        val pkg = call.getString("packageName") ?: run { call.reject("packageName diperlukan"); return }
        try {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:$pkg"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (e: Exception) { call.reject("Tidak bisa membuka Info Aplikasi.") }
    }

    // ─── hapus semua data ─────────────────────────────────────────────────
    @PluginMethod
    fun deleteAllData(call: PluginCall) {
        io.launch {
            UsageDb.get(context).wipe()
            context.getSharedPreferences("pantau_alerts", android.content.Context.MODE_PRIVATE).edit().clear().apply()
            BlockStore.clear(context)
            context.getSharedPreferences("pantau_sync", android.content.Context.MODE_PRIVATE).edit().clear().apply()
            call.resolve()
        }
    }

    // ─── v0.4: konfigurasi, status batas, hotspot ─────────────────────────
    private fun applyServiceState() {
        val cfg = QuotaConfig.load(context)
        if (cfg.persistentOn && Notifier.canPost(context)) MonitorService.start(context) else MonitorService.stop(context)
    }

    /** UI mengirim seluruh konfigurasi sebagai satu string JSON. Disimpan di perangkat, dibaca Worker/Service. */
    @PluginMethod
    fun setConfig(call: PluginCall) {
        val json = call.getString("json") ?: run { call.reject("json diperlukan"); return }
        try { JSONObject(json) } catch (e: Exception) { call.reject("Konfigurasi tidak valid."); return }
        QuotaConfig.save(context, json)
        applyServiceState()
        BlockerVpnService.ensure(context)
        io.launch {
            try { Notifier.checkAndNotify(context) } catch (e: Exception) { /* abaikan: dicek lagi di jadwal berikutnya */ }
            call.resolve()
        }
    }

    @PluginMethod
    fun getQuotaStatus(call: PluginCall) {
        io.launch {
            try {
                val st = QuotaEngine.evaluate(context, QuotaConfig.load(context))
                val arr = JSONArray()
                for (s in st.items) {
                    arr.put(JSONObject().put("id", s.id).put("kind", s.kind).put("title", s.title)
                        .put("used", s.used).put("quota", s.quota).put("pct", s.pct).put("level", s.level)
                        .put("periodStart", s.periodStart).put("periodEnd", s.periodEnd))
                }
                call.resolve(JSObject().put("items", arr).put("cycleStart", st.cycleStart).put("cycleEnd", st.cycleEnd)
                    .put("dayStart", st.dayStart).put("todayCell", st.todayCell).put("todayWifi", st.todayWifi))
            } catch (e: Exception) {
                call.reject("Gagal menghitung status kuota: ${e.javaClass.simpleName}")
            }
        }
    }

    @PluginMethod
    fun getTetherHours(call: PluginCall) {
        val from = call.getLong("from") ?: 0L
        val to   = call.getLong("to")   ?: System.currentTimeMillis()
        io.launch {
            val arr = JSONArray()
            UsageDb.get(context).dao().tetherRange(from, to).forEach {
                arr.put(JSONObject().put("t", it.hourStart).put("net", it.net).put("rx", it.rx).put("tx", it.tx))
            }
            call.resolve(JSObject().put("rows", arr))
        }
    }

    /** Perkiraan: apakah ada antarmuka hotspot/tethering yang sedang menyala. */
    @PluginMethod
    fun getHotspotState(call: PluginCall) {
        io.launch {
            val h = Hotspot.detect(context)
            call.resolve(JSObject().put("active", h.active).put("kind", h.kind).put("iface", h.iface ?: "").put("debug", h.debug))
        }
    }

    @PluginMethod
    fun openHotspotSettings(call: PluginCall) {
        val tries = listOf(
            Intent().setClassName("com.android.settings", "com.android.settings.TetherSettings"),
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS)
        )
        for (i in tries) {
            try {
                context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                call.resolve()
                return
            } catch (e: Exception) { /* coba cara berikutnya */ }
        }
        call.reject("Tidak bisa membuka pengaturan hotspot di perangkat ini.")
    }

    /** Fakta mentah tentang perangkat; UI yang menerjemahkannya jadi kartu "Kemampuan perangkat ini". */
    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        io.launch {
            val tetherSeen = try { UsageDb.get(context).dao().tetherCount() > 0 } catch (e: Exception) { false }
            call.resolve(JSObject()
                .put("sdk", Build.VERSION.SDK_INT)
                .put("mobileStats", UsageSync.mobileSupported())
                .put("foregroundSplit", Build.VERSION.SDK_INT >= 28)
                .put("tetherSeen", tetherSeen)
                .put("notifications", notificationsGranted()))
        }
    }

    /** Rasio foreground vs background satu aplikasi pada rentang waktu (butuh Android 9+). */
    @PluginMethod
    fun getAppForeground(call: PluginCall) {
        val uid  = call.getInt("uid")   ?: run { call.reject("uid diperlukan"); return }
        val from = call.getLong("from") ?: 0L
        val to   = call.getLong("to")   ?: System.currentTimeMillis()
        io.launch {
            val r = try { UsageSync.foregroundSplit(context, uid, from, to) } catch (e: Exception) { null }
            if (r == null) call.resolve(JSObject().put("supported", false).put("fg", 0L).put("bg", 0L))
            else call.resolve(JSObject().put("supported", true).put("fg", r[0]).put("bg", r[1]))
        }
    }

    // ─── v0.5: pemblokiran lewat VPN lokal ───────────────────────────────
    /** Munculkan dialog izin VPN milik sistem (satu-satunya cara memperoleh izin ini). */
    @PluginMethod
    fun requestVpn(call: PluginCall) {
        val i = VpnService.prepare(context)
        if (i == null) { call.resolve(JSObject().put("granted", true)); return }
        startActivityForResult(call, i, "vpnResult")
    }

    @ActivityCallback
    fun vpnResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        call.resolve(JSObject().put("granted", VpnService.prepare(context) == null))
    }

    @PluginMethod
    fun getVpnState(call: PluginCall) {
        io.launch {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            // Proses ini tidak melewati VPN kita; kalau jaringan aktifnya berupa VPN, berarti VPN LAIN sedang aktif.
            val otherVpn = try {
                val caps = cm.getNetworkCapabilities(cm.activeNetwork)
                caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
            } catch (e: Exception) { false }
            val auto = JSONArray()
            for ((pkg, until) in BlockStore.autoBlocked(context)) auto.put(JSONObject().put("pkg", pkg).put("until", until))
            call.resolve(JSObject()
                .put("prepared", BlockerVpnService.prepared(context))
                .put("running", BlockerVpnService.running)
                .put("blocked", BlockerVpnService.blockedCount)
                .put("dropped", BlockerVpnService.dropped.get())
                .put("otherVpn", otherVpn)
                .put("revokedAt", BlockerVpnService.revokedAt)
                .put("autoBlocked", auto))
        }
    }

    /** Pengguna membuka blokir otomatis suatu aplikasi sebelum periodenya berakhir. */
    @PluginMethod
    fun releaseAutoBlock(call: PluginCall) {
        val pkg = call.getString("pkg") ?: run { call.reject("pkg diperlukan"); return }
        BlockStore.release(context, pkg)
        BlockerVpnService.poke(context)
        call.resolve()
    }

    @PluginMethod
    fun openVpnSettings(call: PluginCall) {
        try {
            context.startActivity(Intent(Settings.ACTION_VPN_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (e: Exception) { call.reject("Pengaturan VPN tidak tersedia di perangkat ini.") }
    }
}
