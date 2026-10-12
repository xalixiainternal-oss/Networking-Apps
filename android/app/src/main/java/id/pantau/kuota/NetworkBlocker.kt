package id.pantau.kuota

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class BlockerResult(val ok: Boolean, val message: String, val engine: String)

interface NetworkBlocker {
    suspend fun startBlocking(): BlockerResult
    suspend fun stopBlocking(): BlockerResult
    suspend fun blockApp(uid: Int): BlockerResult
    suspend fun unblockApp(uid: Int): BlockerResult
}

object BlockerFactory {
    fun activeEngine(context: Context, mode: String = QuotaConfig.load(context).blockerMode): NetworkBlocker {
        return if (mode != "vpn") ShizukuFirstBlocker(context) else VpnBlocker(context)
    }

    fun ensure(context: Context) {
        try {
            val cfg = QuotaConfig.load(context)
            if (!cfg.blockOn) {
                CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                    if (!ShizukuBlocker(context).clearAllRules()) {
                        Log.w("BlockerFactory", "Aturan firewall Shizuku belum dapat dibersihkan.")
                        Notifier.notifyInfo(context, "shizuku.cleanup-failed", "Aturan Shizuku belum dibersihkan",
                            "Shizuku tidak siap untuk menghapus aturan lama. Jalankan kembali Shizuku dan buka aplikasi agar aturan dapat dibersihkan.")
                    }
                }
                if (BlockerVpnService.running) BlockerVpnService.poke(context)
                return
            }
            if (cfg.blockerMode != "vpn") {
                BlockerVpnService.ensureCoordinator(context)
            } else {
                BlockerVpnService.ensure(context)
            }
        } catch (e: Exception) {
            android.util.Log.e("BlockerFactory", "Gagal memilih mode pemblokir.", e)
            BlockerVpnService.ensure(context)
        }
    }
}

private class ShizukuFirstBlocker(private val context: Context) : NetworkBlocker {
    private val shizuku = ShizukuBlocker(context)
    private val vpn = VpnBlocker(context)

    override suspend fun startBlocking(): BlockerResult {
        val result = shizuku.startBlocking()
        return if (result.ok) result else vpn.startBlocking()
    }

    override suspend fun stopBlocking(): BlockerResult {
        val result = shizuku.stopBlocking()
        val vpnResult = vpn.stopBlocking()
        return if (result.ok) result else BlockerResult(false, "${result.message} ${vpnResult.message}", "vpn")
    }

    override suspend fun blockApp(uid: Int): BlockerResult {
        val result = shizuku.blockApp(uid)
        return if (result.ok) result else vpn.blockApp(uid)
    }

    override suspend fun unblockApp(uid: Int): BlockerResult {
        val result = shizuku.unblockApp(uid)
        if (result.ok) return result
        val vpnResult = vpn.unblockApp(uid)
        return BlockerResult(false,
            "${vpnResult.message} Shizuku tidak dapat menghapus firewall lama; aturan mungkin masih berlaku.",
            "vpn")
    }
}

private class VpnBlocker(private val context: Context) : NetworkBlocker {
    override suspend fun startBlocking(): BlockerResult = withContext(Dispatchers.Main) {
        BlockerVpnService.ensure(context)
        BlockerResult(true, "Pemblokir VPN dijalankan bila izin VPN tersedia.", "vpn")
    }

    override suspend fun stopBlocking(): BlockerResult = withContext(Dispatchers.Main) {
        BlockStore.clearManual(context)
        BlockerVpnService.poke(context)
        BlockerResult(true, "Aturan manual VPN dibersihkan.", "vpn")
    }

    override suspend fun blockApp(uid: Int): BlockerResult = withContext(Dispatchers.Main) {
        val packages = VpnBlockerSupport.packagesForUid(context, uid)
        if (packages.isEmpty()) return@withContext BlockerResult(false, "UID tidak memiliki aplikasi yang dapat diblokir.", "vpn")
        packages.forEach { BlockStore.putManual(context, it, true) }
        BlockerVpnService.poke(context)
        BlockerResult(true, "Aturan VPN disiapkan untuk ${packages.size} paket.", "vpn")
    }

    override suspend fun unblockApp(uid: Int): BlockerResult = withContext(Dispatchers.Main) {
        val packages = VpnBlockerSupport.packagesForUid(context, uid)
        packages.forEach { BlockStore.putManual(context, it, false) }
        BlockerVpnService.poke(context)
        BlockerResult(true, "Aturan VPN dibuka untuk ${packages.size} paket.", "vpn")
    }
}

internal object VpnBlockerSupport {
    fun packagesForUid(context: Context, uid: Int): List<String> {
        if (uid < 10_000) return emptyList()
        return try { context.packageManager.getPackagesForUid(uid)?.toList().orEmpty() }
        catch (e: Exception) {
            android.util.Log.e("VpnBlocker", "Tidak dapat memetakan UID ke paket.", e)
            emptyList()
        }
    }
}
