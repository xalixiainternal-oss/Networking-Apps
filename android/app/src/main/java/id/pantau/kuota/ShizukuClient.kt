package id.pantau.kuota

import android.content.ComponentName
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import rikka.shizuku.Shizuku
import kotlinx.coroutines.CancellableContinuation
import kotlin.coroutines.resume

internal object ShizukuServiceClient {
    private const val TAG = "ShizukuServiceClient"
    private val lock = Any()
    @Volatile private var remote: IShellService? = null
    private var binding = false
    private val waiters = mutableListOf<CancellableContinuation<IShellService?>>()

    private val args = Shizuku.UserServiceArgs(
        ComponentName("id.pantau.kuota", ShizukuUserService::class.java.name)
    ).daemon(false).processNameSuffix("shell").debuggable(BuildConfig.DEBUG).version(BuildConfig.VERSION_CODE)

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val api = service?.let { IShellService.Stub.asInterface(it) }
            synchronized(lock) {
                remote = api
                binding = false
                val pending = waiters.toList()
                waiters.clear()
                pending.forEach { if (it.isActive) it.resume(api) }
            }
            if (api == null) Log.e(TAG, "UserService terhubung tanpa Binder yang valid.")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            Log.w(TAG, "Koneksi UserService terputus.")
            synchronized(lock) { remote = null; binding = false }
        }
    }

    suspend fun execute(operation: Int, uid: Int = 0, packageName: String = "", enabled: Boolean = false): ShellResult =
        withContext(Dispatchers.IO) {
            try {
                val api = awaitService()
                    ?: return@withContext ShellResult(-1, "", "Shizuku/UserService tidak merespons.")
                val response = api.execute(operation, uid, packageName, enabled)
                if (response.size < 3) return@withContext ShellResult(-1, "", "Respons UserService tidak valid.")
                ShellResult(response[0].toIntOrNull() ?: -1, response[1].orEmpty(), response[2].orEmpty())
            } catch (e: Exception) {
                Log.e(TAG, "Panggilan Shizuku gagal (operasi $operation).", e)
                synchronized(lock) { remote = null; binding = false }
                try { Shizuku.unbindUserService(args, connection, true) }
                catch (unbindError: Exception) { Log.w(TAG, "Gagal melepas UserService setelah Binder putus.", unbindError) }
                ShellResult(-1, "", "${e.javaClass.simpleName}: ${e.message ?: "gagal"}")
            }
        }

    /** Jalankan argv bebas (untuk PRANK_SHELL / iptables). */
    suspend fun execute(operation: Int, rawArgv: List<String>): ShellResult =
        withContext(Dispatchers.IO) {
            try {
                val api = awaitService()
                    ?: return@withContext ShellResult(-1, "", "Shizuku/UserService tidak merespons.")
                val response = api.executeArgv(operation, rawArgv.toTypedArray())
                if (response.size < 3) return@withContext ShellResult(-1, "", "Respons UserService tidak valid.")
                ShellResult(response[0].toIntOrNull() ?: -1, response[1].orEmpty(), response[2].orEmpty())
            } catch (e: Exception) {
                Log.e(TAG, "Panggilan Shizuku argv gagal (operasi $operation).", e)
                synchronized(lock) { remote = null; binding = false }
                try { Shizuku.unbindUserService(args, connection, true) }
                catch (unbindError: Exception) { Log.w(TAG, "Gagal melepas UserService setelah putus.", unbindError) }
                ShellResult(-1, "", "${e.javaClass.simpleName}: ${e.message ?: "gagal"}")
            }
        }

    private suspend fun awaitService(): IShellService? {
        remote?.let { return it }
        if (!safeReady()) return null
        val connected = withTimeoutOrNull(CONNECT_TIMEOUT_MS) {
            suspendCancellableCoroutine<IShellService?> { continuation ->
                var shouldBind = false
                synchronized(lock) {
                    remote?.let {
                        continuation.resume(it)
                        return@suspendCancellableCoroutine
                    }
                    waiters.add(continuation)
                    if (!binding) { binding = true; shouldBind = true }
                }
                continuation.invokeOnCancellation {
                    synchronized(lock) { waiters.remove(continuation) }
                }
                if (shouldBind) {
                    try {
                        Shizuku.bindUserService(args, connection)
                    } catch (e: Exception) {
                        Log.e(TAG, "Tidak dapat bind Shizuku UserService.", e)
                        synchronized(lock) {
                            binding = false
                            val pending = waiters.toList()
                            waiters.clear()
                            pending.forEach { if (it.isActive) it.resume(null) }
                        }
                    }
                }
            }
        }
        if (connected != null) return connected
        synchronized(lock) { if (remote == null) binding = false }
        try { Shizuku.unbindUserService(args, connection, true) }
        catch (e: Exception) { Log.w(TAG, "Tidak dapat membersihkan bind Shizuku yang timeout.", e) }
        return null
    }

    fun unbind() {
        try {
            Shizuku.unbindUserService(args, connection, true)
            synchronized(lock) { remote = null; binding = false }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal unbind Shizuku UserService.", e)
        }
    }

    private fun safeReady(): Boolean = try {
        Shizuku.pingBinder() && Shizuku.checkSelfPermission() == android.content.pm.PackageManager.PERMISSION_GRANTED
    } catch (e: Exception) {
        Log.w(TAG, "Shizuku belum siap.", e)
        false
    }

    private const val CONNECT_TIMEOUT_MS = 8_000L
}
