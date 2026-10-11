package id.pantau.kuota

import android.app.AppOpsManager
import android.app.usage.NetworkStats
import android.app.usage.NetworkStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Build
import android.os.Process

data class SyncResult(val ok: Boolean, val rows: Int, val mobileSupported: Boolean, val message: String?)

object UsageSync {
    const val HOUR = 3_600_000L
    private const val DAY = 24 * HOUR

    private val totalLock = Any()
    private val appLock = Any()
    @Volatile private var lastInfoRefresh = 0L

    private class Acc { var rx = 0L; var tx = 0L }
    private data class AppKey(val uid: Int, val hour: Long, val net: String)
    private data class TetherKey(val hour: Long, val net: String)

    private val NETS = listOf(
        ConnectivityManager.TYPE_WIFI to "wifi",
        ConnectivityManager.TYPE_MOBILE to "cell"
    )

    fun hasUsageAccess(c: Context): Boolean {
        val ops = c.getSystemService(AppOpsManager::class.java)
        return usageMode(ops, c) == AppOpsManager.MODE_ALLOWED
    }

    @Suppress("DEPRECATION")
    private fun usageMode(ops: AppOpsManager, c: Context): Int =
        if (Build.VERSION.SDK_INT >= 29)
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.packageName)
        else
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.packageName)

    /**
     * Android 10+ (API 29): subscriberId null = semua SIM digabung.
     * Android 8–9: data seluler butuh subscriberId → tidak kita minta, jadi hanya Wi-Fi.
     */
    fun mobileSupported() = Build.VERSION.SDK_INT >= 29

    // ─────────────────────────────────────────────────────────────────────────
    // Sync TOTAL (usage_hour)
    // ─────────────────────────────────────────────────────────────────────────
    fun sync(c: Context): SyncResult = synchronized(totalLock) { doSync(c) }

    private fun doSync(c: Context): SyncResult {
        if (!hasUsageAccess(c)) return SyncResult(false, 0, mobileSupported(), "Akses Penggunaan belum diberikan.")
        val dao = UsageDb.get(c).dao()
        val nsm = c.getSystemService(NetworkStatsManager::class.java)
        val now = System.currentTimeMillis()
        val last = dao.latestHour()
        var h = (if (last == null) now - 14 * DAY else last - 2 * HOUR).let { it - Math.floorMod(it, HOUR) }
        val end = now - Math.floorMod(now, HOUR)
        val out = ArrayList<UsageHour>(256)
        var failed: String? = null
        while (h <= end) {
            for ((type, name) in NETS) {
                if (type == ConnectivityManager.TYPE_MOBILE && !mobileSupported()) continue
                try {
                    val b = nsm.querySummaryForDevice(type, null, h, h + HOUR)
                    if (b.rxBytes + b.txBytes > 0) out.add(UsageHour(h, name, b.rxBytes, b.txBytes))
                } catch (e: Exception) { failed = e.javaClass.simpleName }
            }
            h += HOUR
        }
        if (out.isNotEmpty()) dao.upsert(out)
        return SyncResult(failed == null, out.size, mobileSupported(),
            failed?.let { "Sebagian data tidak bisa dibaca ($it). Mungkin tanpa SIM, mode pesawat, atau dibatasi pabrikan HP." })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sync PER APLIKASI (app_hour) + HOTSPOT (tether_hour)
    // ─────────────────────────────────────────────────────────────────────────
    fun syncApps(c: Context): SyncResult = synchronized(appLock) { doSyncApps(c) }

    private fun doSyncApps(c: Context): SyncResult {
        if (!hasUsageAccess(c)) return SyncResult(false, 0, mobileSupported(), "Akses Penggunaan belum diberikan.")
        val dao = UsageDb.get(c).dao()
        val nsm = c.getSystemService(NetworkStatsManager::class.java)
        val now = System.currentTimeMillis()
        // Pertama kali: 7 hari. Selanjutnya: 2 jam overlap agar jam berjalan dihitung ulang (REPLACE idempoten).
        val last = dao.latestAppHour()
        // Update dari v0.3: tabel hotspot masih kosong, jadi sekali saja baca ulang 7 hari ke belakang.
        val prefs = c.getSharedPreferences("pantau_sync", Context.MODE_PRIVATE)
        val needTetherBackfill = !prefs.getBoolean("tetherBackfill", false)
        var h = (if (last == null || needTetherBackfill) now - 7 * DAY else last - 2 * HOUR).let { it - Math.floorMod(it, HOUR) }
        val end = now - Math.floorMod(now, HOUR)
        val apps = HashMap<AppKey, Acc>()
        val tether = HashMap<TetherKey, Acc>()
        var failed: String? = null

        while (h <= end) {
            for ((type, netName) in NETS) {
                if (type == ConnectivityManager.TYPE_MOBILE && !mobileSupported()) continue
                var opened: NetworkStats? = null
                try {
                    val stats = nsm.querySummary(type, null, h, h + HOUR)
                    opened = stats
                    val bucket = NetworkStats.Bucket()
                    while (stats.hasNextBucket()) {
                        stats.getNextBucket(bucket)
                        if (bucket.rxBytes + bucket.txBytes <= 0L) continue
                        val uid = bucket.uid
                        // Satu UID bisa punya BANYAK bucket (metered/roaming/default-network): wajib dijumlahkan,
                        // kalau tidak, baris dengan kunci sama saling menimpa dan angkanya terlalu kecil.
                        val acc = when {
                            uid == NetworkStats.Bucket.UID_TETHERING -> tether.getOrPut(TetherKey(h, netName)) { Acc() }
                            uid >= 0 -> apps.getOrPut(AppKey(uid, h, netName)) { Acc() }
                            else -> null   // UID_REMOVED dll: jadi bagian "Lainnya"
                        }
                        if (acc != null) { acc.rx += bucket.rxBytes; acc.tx += bucket.txBytes }
                    }
                } catch (e: Exception) {
                    failed = e.javaClass.simpleName
                } finally {
                    try { opened?.close() } catch (e: Exception) { }
                }
            }
            h += HOUR
        }

        val appRows = apps.map { (k, a) -> AppHour(k.uid, k.hour, k.net, a.rx, a.tx, 0) }
        val tetherRows = tether.map { (k, a) -> TetherHour(k.hour, k.net, a.rx, a.tx) }
        if (appRows.isNotEmpty()) dao.upsertApp(appRows)
        if (tetherRows.isNotEmpty()) dao.upsertTether(tetherRows)
        if (needTetherBackfill && failed == null) prefs.edit().putBoolean("tetherBackfill", true).apply()

        refreshAppInfo(c, dao)

        return SyncResult(failed == null, appRows.size + tetherRows.size, mobileSupported(),
            failed?.let { "Sebagian data per-aplikasi gagal dibaca ($it)." })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Info aplikasi (nama, paket, sistem?) — dicache, diperbarui paling sering tiap 10 menit
    // ─────────────────────────────────────────────────────────────────────────
    @Suppress("DEPRECATION")
    private fun installedApps(pm: PackageManager): List<ApplicationInfo> =
        if (Build.VERSION.SDK_INT >= 33) pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0L))
        else pm.getInstalledApplications(0)

    /** Aplikasi sistem murni. Chrome/YouTube/Play Store (bawaan yang sudah diperbarui) dianggap aplikasi biasa. */
    private fun isSystemApp(ai: ApplicationInfo): Boolean =
        (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0 && (ai.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0

    private fun refreshAppInfo(c: Context, dao: UsageDao) {
        val nowMs = System.currentTimeMillis()
        if (nowMs - lastInfoRefresh < 10 * 60_000L) return
        try {
            val pm = c.packageManager
            val rows = ArrayList<AppInfo>()
            for ((uid, group) in installedApps(pm).groupBy { it.uid }) {
                // Beberapa paket bisa berbagi satu UID: pilih yang punya ikon peluncur, kalau tidak ada, nama paket terkecil.
                val rep = if (group.size == 1) group[0]
                    else group.firstOrNull { pm.getLaunchIntentForPackage(it.packageName) != null }
                        ?: group.minByOrNull { it.packageName }
                        ?: continue
                val label = try { pm.getApplicationLabel(rep).toString() } catch (e: Exception) { rep.packageName }
                rows.add(AppInfo(uid, rep.packageName, label, if (group.all { isSystemApp(it) }) 1 else 0))
            }
            if (rows.isNotEmpty()) { dao.upsertInfo(rows); lastInfoRefresh = nowMs }
        } catch (e: Exception) { /* PackageManager gagal: jangan crash, coba lagi di sinkronisasi berikutnya */ }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rasio foreground vs background untuk SATU aplikasi (dipanggil saat halaman detail dibuka)
    // ─────────────────────────────────────────────────────────────────────────
    /** Hasil: [foreground, background] dalam byte, atau null bila tidak didukung (Android < 9) / gagal dibaca. */
    fun foregroundSplit(c: Context, uid: Int, from: Long, to: Long): LongArray? {
        if (Build.VERSION.SDK_INT < 28 || !hasUsageAccess(c)) return null
        val nsm = c.getSystemService(NetworkStatsManager::class.java)
        val res = LongArray(2)
        var okAny = false
        for ((type, _) in NETS) {
            if (type == ConnectivityManager.TYPE_MOBILE && !mobileSupported()) continue
            val states = intArrayOf(NetworkStats.Bucket.STATE_FOREGROUND, NetworkStats.Bucket.STATE_DEFAULT)
            for (i in states.indices) {
                var opened: NetworkStats? = null
                try {
                    val s = nsm.queryDetailsForUidTagState(type, null, from, to, uid, NetworkStats.Bucket.TAG_NONE, states[i])
                    opened = s
                    val b = NetworkStats.Bucket()
                    while (s.hasNextBucket()) { s.getNextBucket(b); res[i] += b.rxBytes + b.txBytes }
                    okAny = true
                } catch (e: Exception) {
                } finally {
                    try { opened?.close() } catch (e: Exception) { }
                }
            }
        }
        return if (okAny) res else null
    }
}
