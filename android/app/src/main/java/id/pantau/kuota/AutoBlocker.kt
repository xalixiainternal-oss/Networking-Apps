package id.pantau.kuota

import android.content.Context

/**
 * Blokir otomatis saat batas aplikasi terlewati. HANYA untuk aplikasi yang aturannya punya autoBlock = true,
 * yang di UI baru bisa dinyalakan setelah pengguna menyetujui secara eksplisit.
 */
object AutoBlocker {
    fun apply(c: Context, cfg: QuotaConfig, st: QuotaStatus) {
        if (!cfg.blockOn) return
        val allowed = HashMap<String, BlockPolicy.Rule>()
        for (r in cfg.blockRules) if (r.autoBlock) allowed[r.pkg] = r
        if (allowed.isEmpty()) return

        // Per paket, ambil akhir periode terjauh di antara batas yang terlewati (harian / siklus).
        val until = HashMap<String, Long>()
        for (s in st.items) {
            if ((s.kind != "app-day" && s.kind != "app-cycle") || s.quota <= 0L || s.pct < 100.0) continue
            val pkg = s.id.removePrefix("app.").substringBeforeLast(".")
            if (!allowed.containsKey(pkg)) continue
            until[pkg] = maxOf(until[pkg] ?: 0L, s.periodEnd)
        }

        val now = System.currentTimeMillis()
        val active = BlockStore.autoBlocked(c, now)
        var changed = false
        for ((pkg, end) in until) {
            if (BlockStore.releasedUntil(c, pkg) >= end) continue   // pengguna sudah membukanya untuk periode ini
            if ((active[pkg] ?: 0L) >= end) continue                  // sudah diblokir
            BlockStore.putAuto(c, pkg, end)
            changed = true
            val label = allowed[pkg]?.label ?: pkg
            Notifier.notifyInfo(c, "autoblock.$pkg", "$label diblokir",
                "Batas pemakaiannya terlewati, jadi internetnya diblokir sampai periode berganti. Buka Pantau Kuota untuk membukanya.")
        }
        if (changed) BlockerVpnService.ensure(c)
    }
}
