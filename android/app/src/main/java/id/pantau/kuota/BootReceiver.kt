package id.pantau.kuota

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action != Intent.ACTION_BOOT_COMPLETED) return
        UsageWorker.schedule(c)
        UsageWorker.runOnce(c)
        // specialUse boleh dimulai dari BOOT_COMPLETED; hanya bila pengguna belum mematikan notifikasi tetap.
        // Android 12+ sering menolak startService dari latar; untuk bertahan setelah restart, aktifkan "VPN selalu aktif" di sistem.
        BlockerVpnService.ensure(c)
        if (QuotaConfig.load(c).persistentOn && Notifier.canPost(c)) MonitorService.start(c)
    }
}
