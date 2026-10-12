package id.pantau.kuota

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

class UsageWorker(c: Context, p: WorkerParameters) : CoroutineWorker(c, p) {
    override suspend fun doWork(): Result = try {
        UsageSync.sync(applicationContext)
        UsageSync.syncApps(applicationContext)
        Notifier.checkAndNotify(applicationContext)    // v0.4: peringatan 80/90/100%
        BlockerVpnService.ensure(applicationContext)   // evaluasi ulang jadwal walau layar mati / service berhenti
        Result.success()
    } catch (e: Exception) { Result.retry() }

    companion object {
        private const val NAME = "usage-hourly"
        private const val ONCE = "usage-once"

        fun schedule(c: Context) {
            val req = PeriodicWorkRequestBuilder<UsageWorker>(1, TimeUnit.HOURS).build()
            WorkManager.getInstance(c).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** Satu kali jalan segera (data pertama muncul tanpa menunggu jadwal). Tidak menumpuk bila sudah antre. */
        fun runOnce(c: Context) {
            WorkManager.getInstance(c).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<UsageWorker>().build())
        }
    }
}
