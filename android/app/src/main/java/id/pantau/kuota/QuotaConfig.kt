package id.pantau.kuota

import android.content.Context
import org.json.JSONObject

data class AppLimit(val pkg: String, val label: String, val daily: Long, val monthly: Long)
data class BlockSchedule(val enabled: Boolean = false, val startMinute: Int = 8 * 60, val endMinute: Int = 15 * 60)
data class SafetyConfig(
    val disableMobileData: Boolean = false,
    val stopHotspot: Boolean = false,
    val stopLimitedApps: Boolean = false
)

/** Konfigurasi yang diisi pengguna di UI, disalin ke SharedPreferences supaya Worker/Service bisa membacanya tanpa WebView. */
data class QuotaConfig(
    val base: Int = 1000,
    val resetDay: Int = 1,
    val cellQuota: Long = 0L,
    val wifiQuota: Long = 0L,
    val nightOn: Boolean = false,
    val nightStart: Int = 0,
    val nightEnd: Int = 5,
    val nightQuota: Long = 0L,
    val hotspotDaily: Long = 0L,
    val hotspotMonthly: Long = 0L,
    val appLimits: List<AppLimit> = emptyList(),
    val alertsOn: Boolean = true,
    val persistentOn: Boolean = true,
    /** v0.5: saklar utama pemblokiran per aplikasi lewat VPN lokal, dan aturannya. */
    val blockOn: Boolean = false,
    val blockRules: List<BlockPolicy.Rule> = emptyList(),
    val blockSchedule: BlockSchedule = BlockSchedule(),
    val blockerMode: String = "auto",
    val safety: SafetyConfig = SafetyConfig()
) {
    companion object {
        private const val PREFS = "pantau_cfg"
        private const val KEY = "json"

        fun save(c: Context, json: String) {
            c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
        }

        fun load(c: Context): QuotaConfig {
            val raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return QuotaConfig()
            return try { parse(JSONObject(raw)) } catch (e: Exception) { QuotaConfig() }
        }

        fun parse(o: JSONObject): QuotaConfig {
            val night = o.optJSONObject("night")
            val hot = o.optJSONObject("hotspot")
            val schedule = o.optJSONObject("blockSchedule")
            val safety = o.optJSONObject("safety")
            val limits = ArrayList<AppLimit>()
            val arr = o.optJSONArray("appLimits")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val a = arr.optJSONObject(i) ?: continue
                    val pkg = a.optString("pkg", "")
                    if (pkg.isEmpty()) continue
                    limits.add(AppLimit(pkg, a.optString("label", pkg),
                        a.optLong("daily", 0L).coerceAtLeast(0L), a.optLong("monthly", 0L).coerceAtLeast(0L)))
                }
            }
            val rules = ArrayList<BlockPolicy.Rule>()
            val block = o.optJSONObject("block")
            val ra = block?.optJSONArray("rules")
            if (ra != null) {
                for (i in 0 until ra.length()) {
                    val r = ra.optJSONObject(i) ?: continue
                    val pkg = r.optString("pkg", "")
                    if (pkg.isEmpty()) continue
                    val cell = r.optBoolean("cell", false)
                    val wifi = r.optBoolean("wifi", false)
                    val bg = r.optBoolean("bg", false)
                    val auto = r.optBoolean("autoBlock", false)
                    val hot = r.optBoolean("hot", false)
                    if (cell || wifi || bg || auto || hot) rules.add(BlockPolicy.Rule(pkg, r.optString("label", pkg), cell, wifi, bg, auto, hot))
                }
            }
            return QuotaConfig(
                base = if (o.optInt("base", 1000) == 1024) 1024 else 1000,
                resetDay = o.optInt("resetDay", 1).coerceIn(1, 31),
                cellQuota = o.optLong("cellQuota", 0L).coerceAtLeast(0L),
                wifiQuota = o.optLong("wifiQuota", 0L).coerceAtLeast(0L),
                nightOn = night?.optBoolean("on", false) ?: false,
                nightStart = (night?.optInt("startHour", 0) ?: 0).coerceIn(0, 23),
                nightEnd = (night?.optInt("endHour", 5) ?: 5).coerceIn(0, 23),
                nightQuota = (night?.optLong("quota", 0L) ?: 0L).coerceAtLeast(0L),
                hotspotDaily = (hot?.optLong("daily", 0L) ?: 0L).coerceAtLeast(0L),
                hotspotMonthly = (hot?.optLong("monthly", 0L) ?: 0L).coerceAtLeast(0L),
                appLimits = limits,
                alertsOn = o.optBoolean("alerts", true),
                persistentOn = o.optBoolean("persistent", true),
                blockOn = block?.optBoolean("on", false) ?: false,
                blockRules = rules,
                blockSchedule = BlockSchedule(
                    enabled = schedule?.optBoolean("enabled", false) ?: false,
                    startMinute = parseMinute(schedule?.optString("start", "08:00") ?: "08:00", 8 * 60),
                    endMinute = parseMinute(schedule?.optString("end", "15:00") ?: "15:00", 15 * 60)
                ),
                blockerMode = when (o.optString("blockerMode", "auto")) {
                    "vpn" -> "vpn"
                    "shizuku" -> "shizuku"
                    else -> "auto"
                },
                safety = SafetyConfig(
                    disableMobileData = safety?.optBoolean("disableMobileData", false) ?: false,
                    stopHotspot = safety?.optBoolean("stopHotspot", false) ?: false,
                    stopLimitedApps = safety?.optBoolean("stopLimitedApps", false) ?: false
                )
            )
        }

        private fun parseMinute(value: String, fallback: Int): Int {
            val parts = value.split(":")
            if (parts.size != 2) return fallback
            val hour = parts[0].toIntOrNull() ?: return fallback
            val minute = parts[1].toIntOrNull() ?: return fallback
            if (hour !in 0..23 || minute !in 0..59) return fallback
            return hour * 60 + minute
        }
    }
}
