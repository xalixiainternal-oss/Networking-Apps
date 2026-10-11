package id.pantau.kuota

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notifier {
    const val CH_ALERT = "alerts"
    const val CH_MONITOR = "monitor"
    private const val PREFS = "pantau_alerts"

    fun ensureChannels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        val alert = NotificationChannel(CH_ALERT, "Peringatan kuota", NotificationManager.IMPORTANCE_HIGH)
        alert.description = "Peringatan saat pemakaian mencapai 80%, 90%, dan 100% dari batas yang kamu atur."
        val monitor = NotificationChannel(CH_MONITOR, "Pemantau berjalan", NotificationManager.IMPORTANCE_LOW)
        monitor.description = "Notifikasi tetap berisi kecepatan, pemakaian hari ini, dan sisa kuota."
        monitor.setShowBadge(false)
        nm.createNotificationChannel(alert)
        nm.createNotificationChannel(monitor)
    }

    fun canPost(c: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun openAppIntent(c: Context): PendingIntent {
        val i = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /**
     * Cek semua batas; kirim notifikasi hanya saat ambang (80/90/100) BARU terlewati pada periode yang sama.
     * Status "sudah diberi tahu" disimpan per batas: "<awalPeriode>:<kuota>:<level>". Kalau periode ganti
     * atau kuota diubah pengguna, ambang dihitung ulang dari nol.
     */
    fun checkAndNotify(c: Context) {
        val cfg = QuotaConfig.load(c)
        val st = QuotaEngine.evaluate(c, cfg)
        AutoBlocker.apply(c, cfg, st)      // v0.5: tidak bergantung pada saklar peringatan
        if (!cfg.alertsOn) return
        val sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ed = sp.edit()
        var changed = false
        for (s in st.items) {
            if (s.quota <= 0L) continue
            val level = s.level
            if (level == 0) continue
            val parts = (sp.getString(s.id, null) ?: "").split(":")
            val prevLevel = if (parts.size == 3 && parts[0] == s.periodStart.toString() && parts[1] == s.quota.toString())
                parts[2].toIntOrNull() ?: 0 else 0
            if (level > prevLevel && post(c, s, level, cfg.base)) {
                ed.putString(s.id, "${s.periodStart}:${s.quota}:$level")
                changed = true
            }
        }
        if (changed) ed.apply()
    }

    /** Notifikasi informasi sederhana (kanal peringatan). */
    @SuppressLint("MissingPermission")
    fun notifyInfo(c: Context, key: String, title: String, text: String) {
        if (!canPost(c)) return
        ensureChannels(c)
        val n = NotificationCompat.Builder(c, CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat_kuota)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setColor(ContextCompat.getColor(c, R.color.pk_alert))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(c))
            .build()
        try { NotificationManagerCompat.from(c).notify(1000 + Math.floorMod(key.hashCode(), 90000), n) } catch (e: SecurityException) { }
    }

    @SuppressLint("MissingPermission")
    private fun post(c: Context, s: LimitState, level: Int, base: Int): Boolean {
        if (!canPost(c)) return false
        ensureChannels(c)
        val title = when (level) {
            100 -> "${s.title}: HABIS"
            90 -> "${s.title}: 90% terpakai"
            else -> "${s.title}: 80% terpakai"
        }
        val text = "Terpakai ${QuotaMath.fmtBytes(s.used, base)} dari ${QuotaMath.fmtBytes(s.quota, base)}."
        val n = NotificationCompat.Builder(c, Notifier.CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat_kuota)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setColor(ContextCompat.getColor(c, if (level >= 100) R.color.pk_alert else R.color.pk_royal))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(c))
            .build()
        return try {
            NotificationManagerCompat.from(c).notify(1000 + Math.floorMod(s.id.hashCode(), 90000), n)
            true
        } catch (e: SecurityException) { false }
    }
}
