package id.pantau.kuota

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.InputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal object ShellOperation {
    const val CONNECTIVITY_HELP = 1
    const val SET_PACKAGE_NETWORKING = 2
    const val SET_CHAIN3 = 3
    const val GRANT_PERMISSION = 4
    const val MOBILE_DATA = 5
    const val STOP_HOTSPOT = 6
    const val FORCE_STOP = 7
    const val GET_CHAIN3_STATE = 10
    const val GET_PACKAGE_NETWORKING = 11
}

data class ShellResult(val exitCode: Int, val output: String, val error: String) {
    val ok: Boolean get() = exitCode == 0
}

class ShizukuUserService : IShellService.Stub {
    constructor() : super()
    @androidx.annotation.Keep
    constructor(context: Context) : super()

    override fun execute(operation: Int, uid: Int, packageName: String?, enabled: Boolean): Array<String> {
        return try {
            val args = ShellCommandPolicy.build(operation, uid, packageName.orEmpty(), enabled, Build.VERSION.SDK_INT)
                ?: return arrayOf("-1", "", "Operasi atau argumen tidak diizinkan.")
            val process = ProcessBuilder(args).redirectErrorStream(false).start()
            val output = AtomicReference("")
            val error = AtomicReference("")
            val stdout = Thread({ output.set(readBounded(process.inputStream, 8192)) }, "shizuku-stdout")
            val stderr = Thread({ error.set(readBounded(process.errorStream, 4096)) }, "shizuku-stderr")
            stdout.isDaemon = true
            stderr.isDaemon = true
            stdout.start()
            stderr.start()
            val completed = process.waitFor(8, TimeUnit.SECONDS)
            if (!completed) {
                process.destroyForcibly()
                stdout.join(500)
                stderr.join(500)
                return arrayOf("-1", "", "Perintah melewati batas waktu.")
            }
            stdout.join(500)
            stderr.join(500)
            arrayOf(process.exitValue().toString(), output.get(), error.get())
        } catch (e: Exception) {
            Log.e(TAG, "Operasi allowlist $operation gagal.", e)
            arrayOf("-1", "", e.javaClass.simpleName + ": " + (e.message ?: "gagal"))
        }
    }

    override fun destroy() {
        Log.i(TAG, "UserService dimatikan.")
        System.exit(0)
    }

    private fun readBounded(input: InputStream, limit: Int): String {
        val output = StringBuilder()
        val buffer = ByteArray(1024)
        input.use { stream ->
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                if (output.length < limit) {
                    val remaining = limit - output.length
                    output.append(String(buffer, 0, minOf(count, remaining), Charsets.UTF_8))
                }
            }
        }
        return output.toString()
    }

    companion object {
        private const val TAG = "ShizukuShellService"
    }
}

internal object ShellCommandPolicy {
    fun build(operation: Int, uid: Int, pkg: String, enabled: Boolean, sdk: Int): List<String>? {
        if (pkg.isNotEmpty() && !validPackage(pkg)) return null
        if (operation in setOf(
                ShellOperation.SET_PACKAGE_NETWORKING,
                ShellOperation.GET_PACKAGE_NETWORKING,
                ShellOperation.FORCE_STOP
            ) &&
            (pkg.isEmpty() || uid !in 10_000..Int.MAX_VALUE)) return null
        if (operation == ShellOperation.GRANT_PERMISSION && !validPackage(pkg)) return null

        return when (operation) {
            ShellOperation.CONNECTIVITY_HELP -> listOf("cmd", "connectivity", "help")
            ShellOperation.SET_PACKAGE_NETWORKING -> {
                if (sdk < 33) return null
                listOf("cmd", "connectivity", "set-package-networking-enabled", enabled.toString(), pkg)
            }
            ShellOperation.SET_CHAIN3 -> {
                if (sdk < 33) return null
                listOf("cmd", "connectivity", "set-chain3-enabled", enabled.toString())
            }
            ShellOperation.GET_CHAIN3_STATE -> {
                if (sdk < 33) return null
                listOf("cmd", "connectivity", "get-chain3-enabled")
            }
            ShellOperation.GET_PACKAGE_NETWORKING -> {
                if (sdk < 33) return null
                listOf("cmd", "connectivity", "get-package-networking-enabled", pkg)
            }
            ShellOperation.GRANT_PERMISSION -> when (uid) {
                0 -> listOf("appops", "set", pkg, "GET_USAGE_STATS", "allow")
                1 -> if (sdk >= 33) listOf("pm", "grant", pkg, "android.permission.POST_NOTIFICATIONS") else null
                2 -> listOf("pm", "grant", pkg, "android.permission.WRITE_SECURE_SETTINGS")
                3 -> listOf("dumpsys", "deviceidle", "whitelist", "+$pkg")
                else -> null
            }
            ShellOperation.MOBILE_DATA -> listOf("svc", "data", if (enabled) "enable" else "disable")
            ShellOperation.STOP_HOTSPOT -> if (sdk >= 30) listOf("cmd", "wifi", "stop-softap") else null
            ShellOperation.FORCE_STOP -> listOf("am", "force-stop", pkg)
            else -> null
        }
    }

    private fun validPackage(pkg: String): Boolean = PackageNamePolicy.isValid(pkg)
}
