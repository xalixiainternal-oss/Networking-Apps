package id.pantau.kuota

import android.content.Context
import android.content.pm.PackageManager
import java.util.TimeZone

data class LimitState(
    val id: String,
    val kind: String,        // cell | night | wifi | hotspot-day | hotspot-cycle | app-day | app-cycle
    val title: String,
    val used: Long,
    val quota: Long,
    val periodStart: Long,
    val periodEnd: Long
) {
    val pct: Double get() = QuotaMath.percent(used, quota)
    val level: Int get() = QuotaMath.levelFor(pct)
}

data class QuotaStatus(
    val items: List<LimitState>,
    val cycleStart: Long,
    val cycleEnd: Long,
    val dayStart: Long,
    val todayCell: Long,
    val todayWifi: Long
)

/** Satu-satunya tempat angka batas dihitung; dipakai UI, notifikasi peringatan, dan notifikasi tetap. */
object QuotaEngine {
    private const val HOUR = QuotaMath.HOUR

    private fun uidOf(c: Context, pkg: String): Int? = try {
        BlockPolicy.appIdOfUid(c.packageManager.getApplicationInfo(pkg, 0).uid)
    } catch (e: PackageManager.NameNotFoundException) { null } catch (e: Exception) { null }

    fun evaluate(c: Context, cfg: QuotaConfig, now: Long = System.currentTimeMillis()): QuotaStatus {
        val dao = UsageDb.get(c).dao()
        val tz = TimeZone.getDefault()
        val cyc = QuotaMath.cycleRange(now, cfg.resetDay, tz)
        val day0 = QuotaMath.startOfDay(now, tz)
        val to = now + HOUR                      // jam berjalan ikut dihitung
        val cellTotal = dao.sumNet("cell", cyc[0], to)
        val items = ArrayList<LimitState>()

        // Kuota malam: pemakaian seluler di jam malam dihitung ke kuota malam dulu.
        var nightUsed = 0L
        if (cfg.nightOn && cfg.nightQuota > 0L) {
            for (r in dao.range(cyc[0], to)) {
                if (r.net == "cell" && QuotaMath.isNightHour(r.hourStart, cfg.nightStart, cfg.nightEnd, tz)) nightUsed += r.rx + r.tx
            }
            items.add(LimitState("night", "night", "Kuota malam", nightUsed, cfg.nightQuota, cyc[0], cyc[1]))
        }
        if (cfg.cellQuota > 0L) {
            val used = QuotaMath.mainUsed(cellTotal, nightUsed, if (cfg.nightOn) cfg.nightQuota else 0L)
            items.add(LimitState("cell", "cell", "Kuota seluler", used, cfg.cellQuota, cyc[0], cyc[1]))
        }
        if (cfg.wifiQuota > 0L) {
            items.add(LimitState("wifi", "wifi", "Kuota Wi-Fi", dao.sumNet("wifi", cyc[0], to), cfg.wifiQuota, cyc[0], cyc[1]))
        }
        if (cfg.hotspotDaily > 0L) {
            items.add(LimitState("hotspot.day", "hotspot-day", "Hotspot harian", dao.sumTether(day0, to), cfg.hotspotDaily, day0, day0 + 24 * HOUR))
        }
        if (cfg.hotspotMonthly > 0L) {
            items.add(LimitState("hotspot.cycle", "hotspot-cycle", "Hotspot siklus ini", dao.sumTether(cyc[0], to), cfg.hotspotMonthly, cyc[0], cyc[1]))
        }
        for (l in cfg.appLimits) {
            val uid = uidOf(c, l.pkg) ?: continue
            if (l.daily > 0L) {
                items.add(LimitState("app.${l.pkg}.day", "app-day", "${l.label} (harian)", dao.sumApp(uid, "cell", day0, to), l.daily, day0, day0 + 24 * HOUR))
            }
            if (l.monthly > 0L) {
                items.add(LimitState("app.${l.pkg}.cycle", "app-cycle", "${l.label} (siklus)", dao.sumApp(uid, "cell", cyc[0], to), l.monthly, cyc[0], cyc[1]))
            }
        }
        return QuotaStatus(items, cyc[0], cyc[1], day0, dao.sumNet("cell", day0, to), dao.sumNet("wifi", day0, to))
    }
}
