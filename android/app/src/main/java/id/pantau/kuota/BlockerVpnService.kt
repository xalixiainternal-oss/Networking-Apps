package id.pantau.kuota

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import androidx.core.content.ContextCompat
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicLong

/**
 * Pemblokiran internet per aplikasi TANPA root, memakai VPN lokal.
 *
 * Cara kerja: VPN dibuat hanya untuk aplikasi yang sedang harus diblokir (addAllowedApplication). Semua paket
 * mereka masuk ke antarmuka TUN dan langsung dibuang (tidak pernah diteruskan). Aplikasi lain TIDAK melewati VPN
 * sama sekali, jadi tidak ada penerusan paket, tidak ada beban performa/baterai untuk mereka.
 *
 * Aturan per jaringan (seluler/Wi-Fi) dan background dijalankan dengan membangun ulang VPN bila himpunan
 * aplikasi yang harus diblokir berubah. Himpunan KOSONG berarti VPN ditutup (jangan pernah membuat VPN tanpa
 * addAllowedApplication: seluruh trafik HP akan masuk ke sana).
 *
 * Batasan jujur: memakai SATU slot VPN (tidak bisa bersamaan dengan VPN lain); paket dibuang, bukan ditolak cepat,
 * jadi aplikasi terlihat "menunggu"/timeout; deteksi aplikasi di layar memakai polling tiap ~2 detik.
 */
class BlockerVpnService : VpnService() {
    private val handler = Handler(Looper.getMainLooper())
    private var tun: ParcelFileDescriptor? = null
    private var current: Set<String> = emptySet()
    private var net = "other"
    private var fg: String? = null
    private var screenOn = true
    private var lastEventTs = 0L
    private var registered = false
    private var netCb: ConnectivityManager.NetworkCallback? = null

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                ACTION_REFRESH -> recompute()
                Intent.ACTION_SCREEN_OFF -> { screenOn = false; recompute() }
                Intent.ACTION_SCREEN_ON -> { screenOn = true; pollForeground(); recompute() }
            }
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            val needFg = screenOn && QuotaConfig.load(this@BlockerVpnService).blockRules.any { it.bg }
            if (needFg) pollForeground()
            recompute()
            handler.postDelayed(this, if (needFg) 2_000L else 30_000L)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        running = true
        if (!registered) register()
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_STICKY
    }

    override fun onRevoke() {
        // Pengguna mencabut izin VPN, atau VPN lain mengambil alih slot.
        revokedAt = System.currentTimeMillis()
        closeTun()
        Notifier.notifyInfo(this, "vpn.revoked", "Pemblokiran berhenti",
            "Slot VPN diambil VPN lain atau izinnya dicabut. Buka Pantau Kuota > Pengaturan untuk mengaktifkannya lagi.")
        super.onRevoke()
    }

    override fun onDestroy() {
        running = false
        blockedCount = 0
        handler.removeCallbacksAndMessages(null)
        if (registered) {
            try { unregisterReceiver(receiver) } catch (e: Exception) { }
            try { netCb?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } } catch (e: Exception) { }
            registered = false
        }
        closeTun()
        super.onDestroy()
    }

    // ── pendaftaran penerima & pemantau jaringan ─────────────────────────────
    private fun register() {
        val f = IntentFilter()
        f.addAction(ACTION_REFRESH)
        f.addAction(Intent.ACTION_SCREEN_ON)
        f.addAction(Intent.ACTION_SCREEN_OFF)
        ContextCompat.registerReceiver(this, receiver, f, ContextCompat.RECEIVER_NOT_EXPORTED)

        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                val t = when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cell"
                    else -> "other"
                }
                handler.post { if (net != t) { net = t; recompute() } }
            }
            override fun onLost(network: Network) {
                handler.post { if (net != "other") { net = "other"; recompute() } }
            }
        }
        try {
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(cb)
            netCb = cb
        } catch (e: Exception) { /* tanpa pemantau jaringan, aturan per-jaringan tidak berganti otomatis */ }
        registered = true
    }

    // ── aplikasi di layar (untuk aturan "blokir saat background") ─────────────
    @Suppress("DEPRECATION")
    private fun pollForeground() {
        try {
            val usm = getSystemService(UsageStatsManager::class.java)
            val now = System.currentTimeMillis()
            // Pertama kali mundur 3 jam supaya aplikasi yang sudah lama di layar tetap terdeteksi.
            val from = if (lastEventTs == 0L) now - 3 * 3_600_000L else lastEventTs
            val events = usm.queryEvents(from, now)
            val e = UsageEvents.Event()
            var newFg = fg
            while (events.hasNextEvent()) {
                events.getNextEvent(e)
                lastEventTs = maxOf(lastEventTs, e.timeStamp + 1)
                if (e.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) newFg = e.packageName
                else if (e.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND && newFg == e.packageName) newFg = null
            }
            if (newFg != fg) { fg = newFg; recompute() }
        } catch (e: Exception) { /* tanpa Akses Penggunaan: dianggap tidak diketahui (semua background) */ }
    }

    // ── inti: hitung himpunan yang harus diblokir, bangun ulang VPN bila berubah ─
    private fun recompute() {
        val cfg = QuotaConfig.load(this)
        if (!cfg.blockOn) { closeTun(); stopSelf(); return }
        val set = BlockPolicy.blockedSet(cfg.blockRules, net, fg, screenOn, BlockStore.autoBlocked(this), System.currentTimeMillis(), packageName)
        if (set == current && (tun != null || set.isEmpty())) return
        if (set.isEmpty()) { closeTun(); current = set; blockedCount = 0; return }
        establishFor(set)
    }

    private fun establishFor(set: Set<String>) {
        val b = Builder()
            .setSession("Pantau Kuota: pemblokiran")
            .addAddress("10.255.255.1", 32)
            .addAddress("fd00:ffff::1", 128)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)           // tanpa rute IPv6, trafik IPv6 aplikasi lolos dari blokir
            .setBlocking(true)
        var added = 0
        for (p in set) {
            try { b.addAllowedApplication(p); added++ } catch (e: PackageManager.NameNotFoundException) { /* sudah dihapus */ }
        }
        if (added == 0) { closeTun(); current = set; blockedCount = 0; return }   // JANGAN establish tanpa allowed app

        val pfd = try { b.establish() } catch (e: Exception) { null }
        if (pfd == null) return        // izin VPN hilang; dicoba lagi pada tick berikutnya
        val old = tun
        tun = pfd
        current = set
        blockedCount = added
        startDrain(pfd)
        try { old?.close() } catch (e: Exception) { }
    }

    /** Baca dan buang semua paket dari TUN. Tidak ada yang diteruskan ke jaringan. */
    private fun startDrain(pfd: ParcelFileDescriptor) {
        val t = Thread {
            try {
                val input = FileInputStream(pfd.fileDescriptor)
                val buf = ByteArray(32767)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (n > 0) dropped.incrementAndGet()
                }
            } catch (e: Exception) { /* fd ditutup */ }
        }
        t.name = "pantau-drain"
        t.isDaemon = true
        t.start()
    }

    private fun closeTun() {
        try { tun?.close() } catch (e: Exception) { }
        tun = null
        current = emptySet()
        blockedCount = 0
    }

    companion object {
        const val ACTION_REFRESH = "id.pantau.kuota.BLOCK_REFRESH"
        @Volatile var running = false
        @Volatile var blockedCount = 0
        @Volatile var revokedAt = 0L
        val dropped = AtomicLong(0L)

        fun prepared(c: Context): Boolean = VpnService.prepare(c) == null

        /** Beri tahu layanan yang sedang berjalan agar menghitung ulang (aman dipanggil dari mana pun). */
        fun poke(c: Context) {
            try { c.sendBroadcast(Intent(ACTION_REFRESH).setPackage(c.packageName)) } catch (e: Exception) { }
        }

        /** Pastikan keadaan layanan sesuai konfigurasi. startService dari latar bisa ditolak Android 8+; itu ditangani diam-diam. */
        fun ensure(c: Context) {
            val cfg = QuotaConfig.load(c)
            if (!cfg.blockOn) { if (running) poke(c); return }
            if (!prepared(c)) return
            if (running) { poke(c); return }
            try { c.startService(Intent(c, BlockerVpnService::class.java)) } catch (e: Exception) { }
        }
    }
}
