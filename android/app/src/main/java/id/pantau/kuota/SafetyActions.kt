package id.pantau.kuota

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal object SafetyActions {
    private const val TAG = "SafetyActions"
    private const val PREFS = "pantau_safety"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()

    fun apply(context: Context, cfg: QuotaConfig, status: QuotaStatus) {
        if (cfg.blockerMode == "vpn" || !ShizukuBlocker.isReady()) return
        scope.launch {
            mutex.withLock {
                val blocker = ShizukuBlocker(context)
                try {
                    restoreMobileDataIfNeeded(context, cfg, status, blocker)
                    applyMobileData(context, cfg, status, blocker)
                    applyHotspot(context, cfg, status, blocker)
                    applyLimitedApps(context, cfg, status, blocker)
                } catch (e: Exception) {
                    Log.e(TAG, "Aksi keselamatan gagal.", e)
                    Notifier.notifyInfo(context, "safety.error", "Aksi keselamatan gagal",
                        "Shizuku tidak dapat menjalankan tindakan yang dipilih. Periksa status Shizuku dan pengaturan perangkat.")
                }
            }
        }
    }

    private suspend fun restoreMobileDataIfNeeded(
        context: Context,
        cfg: QuotaConfig,
        status: QuotaStatus,
        blocker: ShizukuBlocker
    ) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ownedCycle = prefs.getLong("mobile_disabled_cycle", 0L)
        if (ownedCycle == 0L || (cfg.safety.disableMobileData && status.cycleStart <= ownedCycle)) return
        val result = blocker.executeChecked(ShellOperation.MOBILE_DATA, enabled = true)
        if (result.ok) {
            prefs.edit().remove("mobile_disabled_cycle").apply()
            Notifier.notifyInfo(context, "safety.mobile-restored", "Data seluler dipulihkan",
                "Siklus kuota telah berganti. Data seluler yang dimatikan Pantau Kuota telah dinyalakan kembali.")
        } else {
            Log.w(TAG, "Pemulihan data seluler gagal: ${result.error}")
            Notifier.notifyInfo(context, "safety.mobile-restore-failed", "Data seluler perlu diperiksa",
                "Pemulihan otomatis gagal. Periksa dan nyalakan data seluler secara manual.")
        }
    }

    private suspend fun applyMobileData(
        context: Context,
        cfg: QuotaConfig,
        status: QuotaStatus,
        blocker: ShizukuBlocker
    ) {
        if (!cfg.safety.disableMobileData) return
        val exceeded = status.items.any { it.kind == "cell" && it.quota > 0L && it.pct >= 100.0 }
        if (!exceeded) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getLong("mobile_disabled_cycle", 0L) == status.cycleStart) return
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val active = manager.getNetworkCapabilities(manager.activeNetwork)
        if (active?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) != true) return
        val result = blocker.executeChecked(ShellOperation.MOBILE_DATA, enabled = false)
        if (result.ok) {
            prefs.edit().putLong("mobile_disabled_cycle", status.cycleStart).apply()
            Notifier.notifyInfo(context, "safety.mobile-disabled", "Data seluler dimatikan",
                "Batas kuota siklus tercapai. Pantau Kuota akan mencoba menyalakan kembali pada awal siklus berikutnya.")
        } else {
            Log.w(TAG, "Pemadaman data seluler gagal: ${result.error}")
            Notifier.notifyInfo(context, "safety.mobile-failed", "Data seluler tidak dimatikan",
                "Perintah sistem tidak didukung atau ditolak. Tindakan ini tidak akan dicoba lagi sampai sinkronisasi berikutnya.")
        }
    }

    private suspend fun applyHotspot(
        context: Context,
        cfg: QuotaConfig,
        status: QuotaStatus,
        blocker: ShizukuBlocker
    ) {
        if (!cfg.safety.stopHotspot) return
        val exceededUntil = status.items.filter {
            (it.kind == "hotspot-day" || it.kind == "hotspot-cycle") && it.quota > 0L && it.pct >= 100.0
        }.maxOfOrNull { it.periodEnd } ?: return
        if (!Hotspot.detect(context).active) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val actionKey = "hotspot_stopped_cycle"
        if (prefs.getLong(actionKey, 0L) >= exceededUntil) return
        val result = blocker.executeChecked(ShellOperation.STOP_HOTSPOT)
        if (result.ok) {
            prefs.edit().putLong(actionKey, exceededUntil).apply()
            Notifier.notifyInfo(context, "safety.hotspot-stopped", "Hotspot dihentikan",
                "Batas pemakaian hotspot tercapai. Nyalakan kembali secara manual bila diperlukan.")
        } else {
            Log.w(TAG, "Penghentian hotspot gagal: ${result.error}")
            Notifier.notifyInfo(context, "safety.hotspot-failed", "Hotspot tidak dihentikan",
                "Perintah penghentian hotspot tidak didukung atau ditolak pada perangkat ini.")
        }
    }

    private suspend fun applyLimitedApps(
        context: Context,
        cfg: QuotaConfig,
        status: QuotaStatus,
        blocker: ShizukuBlocker
    ) {
        if (!cfg.safety.stopLimitedApps) return
        val overLimit = status.items.filter {
            (it.kind == "app-day" || it.kind == "app-cycle") && it.quota > 0L && it.pct >= 100.0
        }.groupBy { it.id.removePrefix("app.").substringBeforeLast(".") }
            .mapValues { (_, limitsForApp) -> limitsForApp.maxOf { it.periodEnd } }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val limits = cfg.appLimits.associateBy { it.pkg }
        for ((pkg, until) in overLimit) {
            if (!limits.containsKey(pkg) || !canStop(context, pkg)) continue
            val key = "app_stopped.$pkg"
            if (prefs.getLong(key, 0L) >= until) continue
            val info = try { context.packageManager.getApplicationInfo(pkg, 0) } catch (_: Exception) { continue }
            val uid = info.uid
            val result = blocker.executeChecked(ShellOperation.FORCE_STOP, uid, pkg)
            if (result.ok) {
                prefs.edit().putLong(key, until).apply()
                Notifier.notifyInfo(context, "safety.app-stopped.$pkg", "Aplikasi dihentikan",
                    "${limits[pkg]?.label ?: pkg} mencapai batas data. Aplikasi dapat dibuka kembali secara manual.")
            } else {
                Log.w(TAG, "Force-stop $pkg gagal: ${result.error}")
                Notifier.notifyInfo(context, "safety.app-failed.$pkg", "Aplikasi tidak dihentikan",
                    "Perintah sistem untuk ${limits[pkg]?.label ?: pkg} gagal atau tidak didukung.")
            }
        }
    }

    private fun canStop(context: Context, pkg: String): Boolean {
        if (!PackageNamePolicy.isValid(pkg) || pkg == context.packageName) return false
        if (pkg.startsWith("android.") || pkg.startsWith("com.android.") ||
            pkg in setOf("com.google.android.dialer", "com.google.android.emergency", "com.android.emergency")) return false
        return try {
            val info = context.packageManager.getApplicationInfo(pkg, 0)
            if ((info.flags and ApplicationInfo.FLAG_SYSTEM) != 0) return false
            val home = context.packageManager.resolveActivity(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0
            )?.activityInfo?.packageName
            pkg != home
        } catch (e: Exception) {
            Log.w(TAG, "Tidak dapat memverifikasi keamanan target $pkg.", e)
            false
        }
    }

}
