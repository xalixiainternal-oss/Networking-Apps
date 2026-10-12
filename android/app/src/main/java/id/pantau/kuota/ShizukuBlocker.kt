package id.pantau.kuota

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import rikka.shizuku.Shizuku

enum class ShizukuState(val wireValue: String) {
    NOT_INSTALLED("not_installed"),
    NOT_RUNNING("not_running"),
    PERMISSION_REQUIRED("permission_required"),
    READY("ready")
}

data class PermissionGrant(val name: String, val granted: Boolean, val message: String)

class ShizukuBlocker(private val context: Context) : NetworkBlocker {
    override suspend fun startBlocking(): BlockerResult {
        val state = state(context)
        if (state != ShizukuState.READY) return BlockerResult(false, "Shizuku belum siap ($state).", "vpn")
        return try {
            bind()
            BlockerResult(true, "Shizuku siap untuk pemblokiran.", "shizuku")
        } catch (e: Exception) {
            Log.e(TAG, "Bind pemblokir Shizuku gagal.", e)
            BlockerResult(false, "Shizuku gagal dihubungkan: ${e.message}", "vpn")
        }
    }

    override suspend fun stopBlocking(): BlockerResult {
        val cleared = clearAllRules()
        return if (cleared) BlockerResult(true, "Aturan Shizuku dibersihkan.", "shizuku")
        else BlockerResult(false, "Tidak semua aturan dapat dibersihkan; buka Shizuku dan coba lagi.", "shizuku")
    }

    override suspend fun blockApp(uid: Int): BlockerResult = withContext(Dispatchers.IO) {
        try {
            if (uid < MIN_APP_UID) return@withContext BlockerResult(false, "UID tidak valid.", "shizuku")
            val packages = packagesForUid(uid)
            if (packages.isEmpty()) return@withContext BlockerResult(false, "UID tidak memiliki paket terpasang.", "shizuku")
            val result = applyPackages(trackedPackages() + packages)   // aditif: jangan membuka blokir aplikasi lain
            if (result.ok) BlockerResult(true, "Aplikasi diblokir oleh Shizuku.", "shizuku")
            else BlockerResult(false, "${result.message} Beralih ke VPN lokal.", "vpn")
        } catch (e: Exception) {
            Log.e(TAG, "Blokir UID lewat Shizuku gagal.", e)
            BlockerResult(false, "Gagal memblokir UID: ${e.message}. Beralih ke VPN lokal.", "vpn")
        }
    }

    override suspend fun unblockApp(uid: Int): BlockerResult = withContext(Dispatchers.IO) {
        try {
            if (uid < MIN_APP_UID) return@withContext BlockerResult(false, "UID tidak valid.", "shizuku")
            val packages = packagesForUid(uid)
            var ok = true
            for (pkg in packages) {
                val result = executeChecked(ShellOperation.SET_PACKAGE_NETWORKING, uid, pkg, true)
                ok = ok && result.ok
                if (result.ok) removeTrackedPackage(pkg)
            }
            BlockerResult(ok, if (ok) "Blokir aplikasi dibuka." else "Gagal membuka semua aturan Shizuku.", "shizuku")
        } catch (e: Exception) {
            Log.e(TAG, "Buka blokir UID lewat Shizuku gagal.", e)
            BlockerResult(false, "Gagal membuka blokir: ${e.message}", "vpn")
        }
    }

    suspend fun bind(): ShellResult {
        if (state(context) != ShizukuState.READY) return ShellResult(-1, "", "Shizuku tidak siap atau izin belum diberikan.")
        return ShizukuServiceClient.execute(ShellOperation.CONNECTIVITY_HELP)
    }

    suspend fun grantRequiredPermissions(): List<PermissionGrant> {
        val grants = mutableListOf(
            0 to "Akses penggunaan",
            2 to "Pengaturan sistem aman",
            3 to "Pengecualian penghemat baterai"
        )
        if (Build.VERSION.SDK_INT >= 33) grants.add(1 to "Notifikasi")
        return grants.map { (id, label) ->
            try {
                val r = executeChecked(ShellOperation.GRANT_PERMISSION, id, context.packageName)
                if (r.ok) PermissionGrant(label, true, "Berhasil")
                else {
                    val hint = if (id == 0) " Alternatif appops set GET_USAGE_STATS allow belum diaktifkan; uji manual diperlukan." else ""
                    PermissionGrant(label, false, (r.error.ifBlank { r.output }).trim() + hint)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Grant $label gagal.", e)
                PermissionGrant(label, false, "${e.javaClass.simpleName}: ${e.message ?: "gagal"}")
            }
        }
    }

    suspend fun applyPackages(packages: Set<String>): BlockerResult = firewallMutex.withLock {
        withContext(Dispatchers.IO) {
        try {
            val state = state(context)
            if (state != ShizukuState.READY) return@withContext BlockerResult(false, "Shizuku tidak siap.", "vpn")
            if (Build.VERSION.SDK_INT < 33) return@withContext BlockerResult(false, "Firewall tanpa VPN tidak didukung di Android ini.", "vpn")
            val safe = packages.filter(::validPackage).toSet()
            if (safe.size != packages.size) return@withContext BlockerResult(false, "Paket tidak valid ditolak.", "vpn")
            val targets = safe.mapNotNull { pkg -> packageUid(pkg)?.let { pkg to it } }.toMap()
            if (targets.size != safe.size) {
                return@withContext BlockerResult(false, "Paket tidak terlihat atau tidak dapat dipetakan ke UID di profil ini.", "vpn")
            }

            val probe = executeChecked(ShellOperation.CONNECTIVITY_HELP)
            val help = (probe.output + probe.error).lowercase()
            if (!probe.ok || !help.contains("set-package-networking-enabled") ||
                !help.contains("get-package-networking-enabled") ||
                (Build.VERSION.SDK_INT >= 33 && (!help.contains("set-chain3-enabled") || !help.contains("get-chain3-enabled")))) {
                return@withContext BlockerResult(false, "Perintah firewall tidak terdeteksi di perangkat ini.", "vpn")
            }

            val old = trackedPackages()
            val removed = old - safe
            for (pkg in removed) {
                val uid = packageUid(pkg)
                if (uid == null) { removeTrackedPackage(pkg); continue }
                val result = executeChecked(ShellOperation.SET_PACKAGE_NETWORKING, uid, pkg, true)
                if (!result.ok) return@withContext BlockerResult(false, explain(result), "vpn")
                if (parsePackageAllowed(executeChecked(ShellOperation.GET_PACKAGE_NETWORKING, uid, pkg)) != true) {
                    return@withContext BlockerResult(false, "Aturan allow paket $pkg tidak dapat diverifikasi.", "vpn")
                }
                removeTrackedPackage(pkg)
            }

            if (safe.isNotEmpty() && !chain3Owned()) {
                val state = executeChecked(ShellOperation.GET_CHAIN3_STATE)
                val chainAlreadyEnabled = parseChainEnabled(state)
                    ?: return@withContext BlockerResult(false, "Status chain firewall tidak dapat dibaca dengan aman.", "vpn")
                if (chainAlreadyEnabled) {
                    setChain3Owned(false)
                } else {
                    // TODO: verify on target devices; OEM shell implementations can vary.
                    val chain = executeChecked(ShellOperation.SET_CHAIN3, enabled = true)
                    if (!chain.ok) return@withContext BlockerResult(false, explain(chain), "vpn")
                    setChain3Owned(true)
                }
            }
            for (pkg in safe - trackedPackages()) {
                val uid = targets[pkg] ?: continue
                // TODO: test di perangkat; perintah package networking berasal dari Android Connectivity shell dan perlu verifikasi OEM/API.
                val result = executeChecked(ShellOperation.SET_PACKAGE_NETWORKING, uid, pkg, false)
                if (!result.ok) return@withContext BlockerResult(false, explain(result), "vpn")
                if (parsePackageAllowed(executeChecked(ShellOperation.GET_PACKAGE_NETWORKING, uid, pkg)) != false) {
                    return@withContext BlockerResult(false, "Aturan blokir paket $pkg tidak dapat diverifikasi.", "vpn")
                }
                trackPackage(pkg)
            }
            if (safe.isEmpty() && chain3Owned()) {
                // Chain hanya dimatikan bila aplikasi ini yang menyalakannya.
                val chain = executeChecked(ShellOperation.SET_CHAIN3, enabled = false)
                if (chain.ok) setChain3Owned(false)
                else return@withContext BlockerResult(false, explain(chain), "vpn")
            }
            BlockerResult(true, "Aturan firewall Shizuku diterapkan.", "shizuku")
        } catch (e: Exception) {
            Log.e(TAG, "Penerapan aturan firewall gagal.", e)
            BlockerResult(false, "${e.javaClass.simpleName}: ${e.message ?: "gagal"}", "vpn")
        }
        }
    }

    suspend fun clearAllRules(): Boolean = firewallMutex.withLock {
        withContext(Dispatchers.IO) {
        try {
            if (state(context) != ShizukuState.READY) return@withContext trackedPackages().isEmpty()
            var ok = true
            for (pkg in trackedPackages()) {
                val uid = packageUid(pkg)
                if (uid == null) { removeTrackedPackage(pkg); continue }
                val result = executeChecked(ShellOperation.SET_PACKAGE_NETWORKING, uid, pkg, true)
                val allowed = if (result.ok) parsePackageAllowed(executeChecked(ShellOperation.GET_PACKAGE_NETWORKING, uid, pkg)) else null
                if (allowed == true) removeTrackedPackage(pkg) else ok = false
            }
            if (trackedPackages().isEmpty() && chain3Owned()) {
                val chain = executeChecked(ShellOperation.SET_CHAIN3, enabled = false)
                if (chain.ok) setChain3Owned(false) else ok = false
            }
            ok && trackedPackages().isEmpty()
        } catch (e: Exception) {
            Log.e(TAG, "Pembersihan aturan firewall gagal.", e)
            false
        }
        }
    }

    suspend fun executeChecked(operation: Int, uid: Int = 0, pkg: String = "", enabled: Boolean = false): ShellResult {
        if (state(context) != ShizukuState.READY) {
            Log.w(TAG, "Shell operation $operation ditolak karena Shizuku tidak siap.")
            return ShellResult(-1, "", "Shizuku tidak aktif atau izin dicabut.")
        }
        val result = ShizukuServiceClient.execute(operation, uid, pkg, enabled)
        if (!result.ok) Log.w(TAG, "Shell operation $operation gagal: ${result.error.ifBlank { result.output }}")
        return result
    }

    private fun packagesForUid(uid: Int): List<String> {
        if (uid < MIN_APP_UID || uid == android.os.Process.myUid()) return emptyList()
        return context.packageManager.getPackagesForUid(uid)?.filter(::validPackage).orEmpty()
    }

    private fun packageUid(pkg: String): Int? = try {
        val uid = context.packageManager.getApplicationInfo(pkg, 0).uid
        uid.takeIf { it >= MIN_APP_UID }
    } catch (e: PackageManager.NameNotFoundException) {
        null
    } catch (e: Exception) {
        Log.e(TAG, "Tidak dapat membaca UID paket $pkg.", e)
        null
    }

    private fun validPackage(pkg: String): Boolean =
        PackageNamePolicy.isValid(pkg) && pkg != context.packageName

    private fun trackedPackages(): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY_PACKAGES, emptySet()).orEmpty().toSet()

    private fun trackPackage(pkg: String) {
        val next = trackedPackages() + pkg
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY_PACKAGES, next).apply()
    }

    private fun removeTrackedPackage(pkg: String) {
        val next = trackedPackages() - pkg
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY_PACKAGES, next).apply()
    }

    private fun chain3Owned(): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_CHAIN3, false)
    private fun setChain3Owned(value: Boolean) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_CHAIN3, value).apply() }

    private fun explain(result: ShellResult): String = result.error.ifBlank { result.output }.ifBlank { "Perintah ditolak (exit ${result.exitCode})." }

    private fun parseChainEnabled(result: ShellResult): Boolean? =
        if (result.ok) ShellOutputParser.parseEnabled(result.output + "\n" + result.error) else null

    private fun parsePackageAllowed(result: ShellResult): Boolean? =
        if (result.ok) ShellOutputParser.parseEnabled(result.output + "\n" + result.error) else null

    companion object {
        private const val TAG = "ShizukuBlocker"
        private const val PREFS = "pantau_shizuku"
        private const val KEY_PACKAGES = "blocked_packages"
        private const val KEY_CHAIN3 = "chain3_owned"
        private const val MIN_APP_UID = 10_000
        private val firewallMutex = Mutex()

        fun state(context: Context): ShizukuState {
            val installed = try {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo("moe.shizuku.privileged.api", 0)
                true
            } catch (_: PackageManager.NameNotFoundException) {
                false
            } catch (e: Exception) {
                Log.e(TAG, "Tidak dapat memeriksa instalasi Shizuku.", e)
                false
            }
            if (!installed) return ShizukuState.NOT_INSTALLED
            return try {
                if (!Shizuku.pingBinder()) ShizukuState.NOT_RUNNING
                else if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) ShizukuState.PERMISSION_REQUIRED
                else ShizukuState.READY
            } catch (e: Exception) {
                Log.w(TAG, "Tidak dapat memeriksa status Binder Shizuku.", e)
                ShizukuState.NOT_RUNNING
            }
        }

        fun isReady(): Boolean = try {
            Shizuku.pingBinder() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
        } catch (e: Exception) {
            Log.w(TAG, "Shizuku belum siap.", e)
            false
        }

    }
}
