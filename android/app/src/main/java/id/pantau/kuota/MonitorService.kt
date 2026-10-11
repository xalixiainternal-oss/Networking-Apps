package id.pantau.kuota

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.TrafficStats
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Notifikasi tetap: kecepatan, pemakaian hari ini, sisa kuota.
 * Hemat baterai: hanya berdetak saat layar menyala. Saat layar mati, loop menunggu tanpa membaca apa pun;
 * pencatatan per jam tetap dijalankan WorkManager.
 */
class MonitorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    private var lastRx = -1L
    private var lastTx = -1L
    private var lastT = 0L
    private var summary = "Menghitung…"
    private var base = 1000

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifier.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                ServiceCompat.startForeground(
                    this, NOTIF_ID, build("Pantau Kuota", summary),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIF_ID, build("Pantau Kuota", summary))
            }
        } catch (e: Exception) {
            // Android 12+ menolak start dari latar belakang; jangan crash, berhenti saja.
            stopSelf()
            return START_NOT_STICKY
        }
        if (job?.isActive != true) job = scope.launch { loop() }
        return START_STICKY
    }

    override fun onDestroy() {
        job?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun screenOn(): Boolean = getSystemService(PowerManager::class.java).isInteractive

    private suspend fun loop() {
        var lastSummary = 0L
        var lastSync = 0L
        var lastAppSync = 0L
        while (scope.isActive) {
            if (!screenOn()) {
                lastRx = -1L            // jangan hitung selisih lintas masa layar mati
                delay(OFF_POLL_MS)
                continue
            }
            val t = SystemClock.elapsedRealtime()
            try {
                if (t - lastSync > SYNC_MS) {
                    UsageSync.sync(this)
                    lastSync = t
                    if (t - lastAppSync > APP_SYNC_MS) { UsageSync.syncApps(this); lastAppSync = t }
                    Notifier.checkAndNotify(this)
                    lastSummary = 0L    // paksa ringkasan baru
                }
                if (t - lastSummary > SUMMARY_MS) { summary = buildSummary(); lastSummary = t }
                update(speedLine(t), summary)
            } catch (e: Exception) {
                // satu putaran gagal tidak boleh mematikan layanan
            }
            delay(TICK_MS)
        }
    }

    private fun speedLine(t: Long): String {
        val rx = TrafficStats.getTotalRxBytes()
        val tx = TrafficStats.getTotalTxBytes()
        if (rx == TrafficStats.UNSUPPORTED.toLong()) return "Kecepatan tidak didukung HP ini"
        var down = 0L
        var up = 0L
        if (lastRx >= 0L && t > lastT) {
            val sec = (t - lastT) / 1000.0
            down = Math.max(0.0, (rx - lastRx) / sec).toLong()   // selisih negatif (reboot) → 0
            up = Math.max(0.0, (tx - lastTx) / sec).toLong()
        }
        lastRx = rx; lastTx = tx; lastT = t
        return "↓ ${QuotaMath.fmtSpeed(down, base)}   ↑ ${QuotaMath.fmtSpeed(up, base)}"
    }

    private fun buildSummary(): String {
        val cfg = QuotaConfig.load(this)
        base = cfg.base
        val st = QuotaEngine.evaluate(this, cfg)
        val today = QuotaMath.fmtBytes(st.todayCell + st.todayWifi, cfg.base)
        val main = st.items.firstOrNull { it.id == "cell" }
        val rest = if (main != null) "Sisa ${QuotaMath.fmtBytes(Math.max(0L, main.quota - main.used), cfg.base)}" else "Kuota belum diatur"
        return "Hari ini $today • $rest"
    }

    private fun build(title: String, text: String): Notification =
        NotificationCompat.Builder(this, Notifier.CH_MONITOR)
            .setSmallIcon(R.drawable.ic_stat_kuota)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(Notifier.openAppIntent(this))
            .build()

    private fun update(title: String, text: String) {
        getSystemService(android.app.NotificationManager::class.java).notify(NOTIF_ID, build(title, text))
    }

    companion object {
        private const val NOTIF_ID = 42
        private const val TICK_MS = 3_000L
        private const val OFF_POLL_MS = 5_000L
        private const val SUMMARY_MS = 15_000L
        private const val SYNC_MS = 5 * 60_000L
        private const val APP_SYNC_MS = 15 * 60_000L

        fun start(c: Context) {
            try { ContextCompat.startForegroundService(c, Intent(c, MonitorService::class.java)) } catch (e: Exception) { /* ditolak sistem */ }
        }

        fun stop(c: Context) {
            try { c.stopService(Intent(c, MonitorService::class.java)) } catch (e: Exception) { }
        }
    }
}
