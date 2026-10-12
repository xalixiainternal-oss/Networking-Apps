package id.pantau.kuota

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import rikka.shizuku.Shizuku

@CapacitorPlugin(name = "ShizukuControl")
class ShizukuPlugin : Plugin() {
    private val io = CoroutineScope(Dispatchers.IO)
    @Volatile private var permissionCall: PluginCall? = null

    private val binderReceived = Shizuku.OnBinderReceivedListener { emitState() }
    private val binderDead = Shizuku.OnBinderDeadListener { emitState() }
    private val permissionResult = Shizuku.OnRequestPermissionResultListener { requestCode, grantResult ->
        if (requestCode == REQUEST_CODE) {
            permissionCall?.resolve(JSObject().put("granted", grantResult == PackageManager.PERMISSION_GRANTED))
            permissionCall = null
            emitState()
        }
    }

    override fun load() {
        super.load()
        try {
            Shizuku.addBinderReceivedListenerSticky(binderReceived)
            Shizuku.addBinderDeadListener(binderDead)
            Shizuku.addRequestPermissionResultListener(permissionResult)
            emitState()
        } catch (e: Exception) {
            Log.e(TAG, "Tidak dapat mendaftar listener Shizuku.", e)
        }
    }

    override fun handleOnDestroy() {
        try {
            Shizuku.removeBinderReceivedListener(binderReceived)
            Shizuku.removeBinderDeadListener(binderDead)
            Shizuku.removeRequestPermissionResultListener(permissionResult)
        } catch (e: Exception) {
            Log.w(TAG, "Tidak dapat melepas listener Shizuku.", e)
        }
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getShizukuStatus(call: PluginCall) {
        call.resolve(statusJson())
    }

    @PluginMethod
    fun requestShizukuPermission(call: PluginCall) {
        try {
            when (ShizukuBlocker.state(context)) {
                ShizukuState.NOT_INSTALLED -> {
                    call.resolve(JSObject().put("granted", false).put("message", "Shizuku belum terpasang."))
                    return
                }
                ShizukuState.NOT_RUNNING -> {
                    call.resolve(JSObject().put("granted", false).put("message", "Jalankan Shizuku terlebih dahulu."))
                    return
                }
                ShizukuState.READY -> {
                    call.resolve(JSObject().put("granted", true))
                    return
                }
                ShizukuState.PERMISSION_REQUIRED -> Unit
            }
            if (permissionCall != null) {
                call.reject("Permintaan izin Shizuku sebelumnya masih berjalan.")
                return
            }
            permissionCall = call
            Shizuku.requestPermission(REQUEST_CODE)
        } catch (e: Exception) {
            Log.e(TAG, "Permintaan izin Shizuku gagal.", e)
            permissionCall = null
            call.reject("Tidak dapat meminta izin Shizuku: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    @PluginMethod
    fun openShizuku(call: PluginCall) {
        try {
            val launch = context.packageManager.getLaunchIntentForPackage("moe.shizuku.privileged.api")
            if (launch != null) {
                context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                call.resolve()
            } else {
                val store = Intent(Intent.ACTION_VIEW, Uri.parse(
                    "https://play.google.com/store/apps/details?id=moe.shizuku.privileged.api"
                )).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(store)
                call.resolve()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Tidak dapat membuka Shizuku.", e)
            call.reject("Tidak dapat membuka Shizuku: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    @PluginMethod
    fun grantRequiredPermissions(call: PluginCall) {
        io.launch {
            try {
                val grants = ShizukuBlocker(context).grantRequiredPermissions()
                val array = JSArray()
                grants.forEach { array.put(JSObject().put("name", it.name).put("granted", it.granted).put("message", it.message)) }
                call.resolve(JSObject().put("results", array))
            } catch (e: Exception) {
                Log.e(TAG, "Pemberian izin otomatis gagal.", e)
                call.reject("Gagal menjalankan pemberian izin otomatis: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    @PluginMethod
    fun getBlockerBackend(call: PluginCall) {
        val cfg = QuotaConfig.load(context)
        val active = BlockerVpnService.activeBackend
        call.resolve(JSObject().put("requested", cfg.blockerMode)
            .put("active", active)
            .put("fallback", cfg.blockerMode != "vpn" && active == "vpn")
            .put("reason", BlockerVpnService.lastShizukuError))
    }

    private fun emitState() {
        try {
            notifyListeners("shizukuStateChange", statusJson())
            BlockerFactory.ensure(context)
        } catch (e: Exception) {
            Log.w(TAG, "Tidak dapat mengirim event status Shizuku atau menyegarkan backend.", e)
        }
    }

    private fun statusJson(): JSObject {
        val state = ShizukuBlocker.state(context)
        return JSObject().put("state", state.wireValue)
            .put("ready", state == ShizukuState.READY)
            .put("installed", state != ShizukuState.NOT_INSTALLED)
            .put("message", when (state) {
                ShizukuState.NOT_INSTALLED -> "Shizuku belum terpasang."
                ShizukuState.NOT_RUNNING -> "Shizuku terpasang, tetapi belum berjalan."
                ShizukuState.PERMISSION_REQUIRED -> "Shizuku berjalan, tetapi izin aplikasi belum diberikan."
                ShizukuState.READY -> "Shizuku siap digunakan."
            })
    }

    companion object {
        private const val TAG = "ShizukuPlugin"
        private const val REQUEST_CODE = 0x5348
    }
}
