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
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
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
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val handler = Handler(Looper.getMainLooper())
    private var tun: ParcelFileDescriptor? = null
    private var current: Set<String> = emptySet()
    private var net = "other"
    private var fg: String? = null
    private var screenOn = true
    private var hotspotOn = false
    private var lastEventTs = 0L
    private var registered = false
    private var netCb: ConnectivityManager.NetworkCallback? = null
    private var packageAliases: Map<String, Set<String>> = emptyMap()
    @Volatile private var shizukuDesired: Set<String>? = null
    @Volatile private var shizukuBusy = false
    @Volatile private var shizukuApplied = false
    @Volatile private var shizukuFailure = false
    @Volatile private var shizukuGeneration = 0
    @Volatile private var shizukuCleanupPending = false

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
            val rules = QuotaConfig.load(this@BlockerVpnService).blockRules
            val needFg = screenOn && rules.any { it.bg }
            val needHot = rules.any { it.hot }
            if (needHot) pollHotspot() else hotspotOn = false
            if (needFg) pollForeground()
            recompute()
            handler.postDelayed(this, if (needFg) 2_000L else if (needHot) 5_000L else 30_000L)
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
        io.cancel()
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

    // ── hotspot/tethering menyala? (untuk aturan "blokir saat hotspot menyala") ──
    private fun pollHotspot() {
        try { hotspotOn = Hotspot.detect(this).active } catch (e: Exception) { /* tidak diketahui: dianggap mati */ }
    }

    // ── inti: hitung himpunan yang harus diblokir, bangun ulang VPN bila berubah ─
    private fun recompute() {
        val cfg = QuotaConfig.load(this)
        if (!cfg.blockOn) {
            closeTun()
            clearShizukuRules(stopAfter = true)
            return
        }
        val scheduled = if (AutoBlocker.scheduleActive(cfg)) {
            BlockPolicy.blockedSet(cfg.blockRules, net, fg, screenOn, BlockStore.autoBlocked(this),
                System.currentTimeMillis(), packageName, hotspotOn, packageAliases())
        } else emptySet()
        val manual = BlockStore.manualBlocked(this).filter { it != packageName }
        val set: Set<String> = if (manual.isEmpty()) scheduled else java.util.TreeSet(scheduled + manual)
        val wantsShizuku = cfg.blockerMode != "vpn" && ShizukuBlocker.isReady()
        if (wantsShizuku && shizukuFailure && shizukuDesired == set) {
            establishVpnFallback(set)
            return
        }
        if (wantsShizuku) {
            activeBackend = "vpn"
            closeTun()
            current = set
            blockedCount = set.size
            if (shizukuDesired == set && (shizukuBusy || shizukuApplied)) return
            applyShizukuRules(set)
            return
        }
        clearShizukuRules()
        if (cfg.blockerMode == "shizuku" && !ShizukuBlocker.isReady()) {
            Notifier.notifyInfo(this, "shizuku.fallback", "Mode VPN digunakan",
                "Shizuku tidak siap. Pemblokiran dialihkan ke VPN lokal; pastikan izin VPN sudah diberikan.")
        }
        establishVpnFallback(set)
    }

    private fun establishVpnFallback(set: Set<String>) {
        activeBackend = "vpn"
        if (set == current && (tun != null || set.isEmpty())) return
        if (set.isEmpty()) { closeTun(); current = set; blockedCount = 0; return }
        establishFor(set)
    }

    private fun applyShizukuRules(set: Set<String>) {
        shizukuDesired = set
        shizukuBusy = true
        shizukuApplied = false
        shizukuFailure = false
        val generation = ++shizukuGeneration
        io.launch {
            val result = ShizukuBlocker(this@BlockerVpnService).applyPackages(set)
            if (generation != shizukuGeneration) return@launch
            shizukuBusy = false
            shizukuApplied = result.ok
            shizukuFailure = !result.ok
            if (result.ok) activeBackend = "shizuku"
            if (!result.ok) ShizukuBlocker(this@BlockerVpnService).clearAllRules()
            handler.post {
                if (!result.ok) {
                    Log.w(TAG, "Firewall Shizuku gagal; beralih ke VPN: ${result.message}")
                    Notifier.notifyInfo(this@BlockerVpnService, "shizuku.firewall-fallback", "Mode VPN digunakan",
                        "Perintah firewall Shizuku gagal atau tidak didukung. Pemblokiran beralih ke VPN lokal; aturan Shizuku lama mungkin perlu dibersihkan saat Shizuku aktif kembali.")
                }
                recompute()
            }
        }
    }

    private fun clearShizukuRules(stopAfter: Boolean = false) {
        if (shizukuCleanupPending) return
        if (stopAfter && shizukuDesired == null && !shizukuApplied && !shizukuBusy) {
            stopSelf()
            return
        }
        if (shizukuDesired == null && !shizukuApplied && !shizukuBusy) return
        ++shizukuGeneration
        shizukuBusy = false
        shizukuApplied = false
        shizukuFailure = false
        shizukuDesired = null
        activeBackend = "vpn"
        shizukuCleanupPending = true
        io.launch {
            val cleared = ShizukuBlocker(this@BlockerVpnService).clearAllRules()
            if (!cleared) {
                Log.w(TAG, "Aturan Shizuku belum dapat dibersihkan.")
                Notifier.notifyInfo(this@BlockerVpnService, "shizuku.cleanup-failed", "Aturan Shizuku belum dibersihkan",
                    "Shizuku tidak siap untuk menghapus aturan lama. Jalankan kembali Shizuku dan buka aplikasi agar aturan dapat dibersihkan.")
            }
            handler.post {
                shizukuCleanupPending = false
                if (stopAfter && !QuotaConfig.load(this@BlockerVpnService).blockOn) stopSelf()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun packageAliases(): Map<String, Set<String>> {
        if (packageAliases.isNotEmpty()) return packageAliases
        try {
            val pm = packageManager
            val apps = if (android.os.Build.VERSION.SDK_INT >= 33)
                pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0L))
            else pm.getInstalledApplications(0)
            val aliases = apps.groupBy { BlockPolicy.appIdOfUid(it.uid) }
                .mapValues { (_, group) -> group.mapTo(HashSet()) { it.packageName } }
            packageAliases = apps.associate { it.packageName to (aliases[BlockPolicy.appIdOfUid(it.uid)] ?: emptySet()) }
        } catch (e: SecurityException) {
            Log.w(TAG, "Tidak dapat membaca daftar aplikasi untuk memperluas aturan UID bersama.", e)
            packageAliases = emptyMap()
        }
        return packageAliases
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
        private const val TAG = "BlockerVpnService"
        @Volatile var running = false
        @Volatile var blockedCount = 0
        @Volatile var revokedAt = 0L
        @Volatile var activeBackend = "vpn"
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

        fun ensureCoordinator(c: Context) {
            if (!QuotaConfig.load(c).blockOn || running) {
                if (running) poke(c)
                return
            }
            try { c.startService(Intent(c, BlockerVpnService::class.java)) }
            catch (e: Exception) {
                Log.e(TAG, "Tidak dapat menjalankan coordinator Shizuku.", e)
                ensure(c)
            }
        }
    }
}
