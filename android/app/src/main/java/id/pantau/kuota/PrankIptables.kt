package id.pantau.kuota

// PrankIptables.kt — iptables rules via Shizuku untuk WiFi Prank.
// Dijalankan sebagai root user-service, bukan app biasa.
// Language: Kotlin | Runtime: Android (Shizuku root) | Target: API 26+
//
// Chains yang dibuat:
//   PRANK_REDIRECT  — redirect HTTP (port 80) dan DNS (port 53) ke server lokal
//   PRANK_BLOCK     — DROP semua traffic dari IP yang belum login
//
// Semua rules diberi comment "PRANK" agar bisa di-flush bersih saat stop.

import android.util.Log

object PrankIptables {
    private const val TAG = "PrankIptables"
    const val HTTP_PORT = PrankServer.HTTP_PORT  // 8787
    const val DNS_PORT  = 8753

    // ── apply: dipanggil saat prank ON ─────────────────────────────────────

    suspend fun apply(gatewayIp: String): Result<Unit> = runCatching {
        val cmds = buildApplyCommands(gatewayIp)
        for (cmd in cmds) {
            val r = shell(cmd)
            // toleransi "already exists" (-t nat -N)
            if (!r.ok && "already exists" !in r.error && "Chain already exists" !in r.error) {
                Log.w(TAG, "iptables warn: $cmd → ${r.error}")
            }
        }
        Log.i(TAG, "iptables PRANK rules applied (gateway=$gatewayIp)")
    }

    // ── flush: dipanggil saat prank OFF ────────────────────────────────────

    suspend fun flush(): Result<Unit> = runCatching {
        val cmds = buildFlushCommands()
        for (cmd in cmds) {
            val r = shell(cmd)
            if (!r.ok) Log.w(TAG, "iptables flush warn: $cmd → ${r.error}")
        }
        Log.i(TAG, "iptables PRANK rules flushed")
    }

    // ── block / unblock per IP ─────────────────────────────────────────────

    suspend fun blockIp(ip: String): Result<Unit> = runCatching {
        // DROP semua non-HTTP traffic dari IP ini (HTTP tetap lewat → redirect ke server kita)
        shell("iptables -t filter -A PRANK_BLOCK -s $ip ! --dport 80 -j DROP -m comment --comment PRANK_IP_$ip")
        // juga block akses keluar ke internet sebelum login
        shell("iptables -t filter -A PRANK_BLOCK -s $ip -o ! lo -j DROP -m comment --comment PRANK_IP_$ip")
        Log.d(TAG, "blocked $ip")
    }

    suspend fun unblockIp(ip: String): Result<Unit> = runCatching {
        // hapus semua rule dengan comment PRANK_IP_<ip>
        // iptables tidak punya delete-by-comment, jadi list dan delete by line number
        val listOut = shell("iptables -t filter -L PRANK_BLOCK --line-numbers -n").output
        val lines = listOut.lines().reversed() // delete dari bawah agar nomor tidak bergeser
        for (l in lines) {
            if ("PRANK_IP_$ip" in l) {
                val num = l.trim().split("\\s+".toRegex()).firstOrNull()?.toIntOrNull() ?: continue
                shell("iptables -t filter -D PRANK_BLOCK $num")
            }
        }
        Log.d(TAG, "unblocked $ip")
    }

    // ── internals ──────────────────────────────────────────────────────────

    private fun buildApplyCommands(gatewayIp: String) = listOf(
        // buat chain kalau belum ada
        "iptables -t nat    -N PRANK_REDIRECT",
        "iptables -t filter -N PRANK_BLOCK",

        // masukkan chain ke hook utama
        "iptables -t nat    -I PREROUTING 1 -j PRANK_REDIRECT -m comment --comment PRANK",
        "iptables -t filter -I FORWARD    1 -j PRANK_BLOCK    -m comment --comment PRANK",

        // redirect DNS (UDP 53) → DNS port kita
        "iptables -t nat -A PRANK_REDIRECT -i wlan+ -p udp --dport 53 -j REDIRECT --to-port $DNS_PORT -m comment --comment PRANK",
        "iptables -t nat -A PRANK_REDIRECT -i wlan+ -p tcp --dport 53 -j REDIRECT --to-port $DNS_PORT -m comment --comment PRANK",

        // redirect HTTP (port 80) → HTTP server kita
        "iptables -t nat -A PRANK_REDIRECT -i wlan+ -p tcp --dport 80 -j REDIRECT --to-port $HTTP_PORT -m comment --comment PRANK",
    )

    private fun buildFlushCommands() = listOf(
        // hapus jump ke chain kita dari hook utama
        "iptables -t nat    -D PREROUTING -j PRANK_REDIRECT",
        "iptables -t filter -D FORWARD    -j PRANK_BLOCK",
        // flush & hapus chain
        "iptables -t nat    -F PRANK_REDIRECT",
        "iptables -t nat    -X PRANK_REDIRECT",
        "iptables -t filter -F PRANK_BLOCK",
        "iptables -t filter -X PRANK_BLOCK",
    )

    private suspend fun shell(cmd: String): ShellResult {
        // parse ke argv sederhana (tidak ada quoting kompleks di command kita)
        val argv = cmd.trim().split("\\s+".toRegex())
        return try {
            ShizukuServiceClient.execute(
                ShellOperation.PRANK_SHELL,
                rawArgv = argv,
            )
        } catch (e: Exception) {
            Log.e(TAG, "shell($cmd) exception: ${e.message}")
            ShellResult(-1, "", e.message ?: "error")
        }
    }
}
