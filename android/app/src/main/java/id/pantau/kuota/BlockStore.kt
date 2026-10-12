package id.pantau.kuota

import android.content.Context

/** Blokir otomatis (karena batas aplikasi terlewati) yang sedang berlaku, dan penanda "sudah dibuka pengguna". */
object BlockStore {
    private const val PREFS = "pantau_block"
    private fun sp(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** paket -> waktu (ms) blokir berakhir; yang sudah kedaluwarsa tidak ikut. */
    fun autoBlocked(c: Context, now: Long = System.currentTimeMillis()): Map<String, Long> {
        val out = HashMap<String, Long>()
        for ((k, v) in sp(c).all) {
            if (k.startsWith("auto.") && v is Long && v > now) out[k.removePrefix("auto.")] = v
        }
        return out
    }

    fun putAuto(c: Context, pkg: String, until: Long) {
        sp(c).edit().putLong("auto.$pkg", until).apply()
    }

    fun releasedUntil(c: Context, pkg: String): Long = sp(c).getLong("released.$pkg", 0L)

    /** Pengguna membuka blokir: jangan diblokir lagi sampai periode yang memicunya berganti. */
    fun release(c: Context, pkg: String) {
        val until = sp(c).getLong("auto.$pkg", 0L)
        sp(c).edit().remove("auto.$pkg").putLong("released.$pkg", maxOf(until, System.currentTimeMillis())).apply()
    }

    /** Blokir manual (dari tombol/antarmuka): berlaku sampai dibuka pengguna, tidak mengikuti jadwal. */
    fun manualBlocked(c: Context): Set<String> {
        val out = HashSet<String>()
        for ((k, v) in sp(c).all) {
            if (k.startsWith("manual.") && v == true) out.add(k.removePrefix("manual."))
        }
        return out
    }

    fun putManual(c: Context, pkg: String, blocked: Boolean) {
        val e = sp(c).edit()
        if (blocked) e.putBoolean("manual.$pkg", true) else e.remove("manual.$pkg")
        e.apply()
    }

    fun clearManual(c: Context) {
        val e = sp(c).edit()
        for (k in sp(c).all.keys) if (k.startsWith("manual.")) e.remove(k)
        e.apply()
    }

    fun clear(c: Context) { sp(c).edit().clear().apply() }
}
