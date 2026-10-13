package id.pantau.kuota

// PrankServer.kt — HTTP server captive portal palsu, jalan di dalam app Android.
// Port 8787 (HTTP). iptables REDIRECT 80 → 8787 via Shizuku.
// Alur: client connect → halaman login → POST /login → unblock IP → foto.
// Language: Kotlin | Runtime: Android | Target: API 26+

import android.util.Log
import java.io.*
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

data class PrankClient(
    val ip: String,
    val mac: String,
    val connectedAt: Long,
    val loggedIn: Boolean = false,
    val loginAt: Long = 0L,
)

class PrankServer(
    private val gatewayIp: String,
    private val config: PrankServerConfig,
    private val onClientEvent: (PrankClient) -> Unit,
) {
    companion object {
        const val HTTP_PORT = 8787
        private const val TAG = "PrankServer"
        private val MIME_HTML = "text/html; charset=utf-8"
        private val MIME_JSON = "application/json"
        private val MIME_JPEG = "image/jpeg"
        private val MIME_PNG  = "image/png"
    }

    private val running   = AtomicBoolean(false)
    private val pool      = Executors.newCachedThreadPool()
    private var serverSock: ServerSocket? = null

    // ip → client info
    val clients = ConcurrentHashMap<String, PrankClient>()
    // ip yang sudah login → dibuka firewall-nya
    val authorized = ConcurrentHashMap.newKeySet<String>()

    fun start() {
        if (!running.compareAndSet(false, true)) return
        pool.submit {
            try {
                val ss = ServerSocket(HTTP_PORT).also { serverSock = it }
                Log.i(TAG, "PrankServer listening :$HTTP_PORT")
                while (running.get()) {
                    try {
                        val sock = ss.accept()
                        pool.submit { handle(sock) }
                    } catch (e: Exception) {
                        if (running.get()) Log.w(TAG, "accept error", e)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "PrankServer start error", e)
                running.set(false)
            }
        }
    }

    fun stop() {
        running.set(false)
        try { serverSock?.close() } catch (e: Exception) { /* */ }
        pool.shutdownNow()
        clients.clear()
        authorized.clear()
    }

    val isRunning get() = running.get()

    // ── HTTP handler ────────────────────────────────────────────────────────

    private fun handle(sock: Socket) {
        try {
            sock.soTimeout = 10_000
            val ip = sock.inetAddress.hostAddress ?: return
            val inp = sock.getInputStream().bufferedReader()
            val out = sock.getOutputStream()

            // baca request line + headers
            val requestLine = inp.readLine() ?: return
            val headers = mutableMapOf<String, String>()
            var line = inp.readLine()
            while (!line.isNullOrBlank()) {
                val colon = line.indexOf(':')
                if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] =
                    line.substring(colon + 1).trim()
                line = inp.readLine()
            }

            val parts  = requestLine.split(" ")
            val method = parts.getOrElse(0) { "GET" }.uppercase()
            val path   = parts.getOrElse(1) { "/" }.split("?")[0]
            val host   = headers["host"]?.split(":")?.firstOrNull() ?: ""

            // catat client baru
            if (ip != gatewayIp && !clients.containsKey(ip)) {
                val c = PrankClient(ip = ip, mac = "", connectedAt = System.currentTimeMillis())
                clients[ip] = c
                onClientEvent(c)
            }

            // baca body kalau POST
            var body = ""
            if (method == "POST") {
                val len = headers["content-length"]?.toIntOrNull() ?: 0
                if (len > 0) {
                    val buf = CharArray(minOf(len, 4096))
                    inp.read(buf)
                    body = String(buf)
                }
            }

            when {
                path == "/foto" -> serveFoto(out)
                path == "/status" -> serveStatus(out, ip)
                path == "/ping" -> serveText(out, "pong")

                method == "POST" && path == "/login" -> {
                    authorized.add(ip)
                    val updated = (clients[ip] ?: PrankClient(ip, "", System.currentTimeMillis()))
                        .copy(loggedIn = true, loginAt = System.currentTimeMillis())
                    clients[ip] = updated
                    onClientEvent(updated)
                    serveText(out, "OK")
                }

                // captive portal redirect: kalau host bukan gateway, redirect ke gateway
                ip !in authorized && host.isNotEmpty() && host != gatewayIp -> {
                    redirect(out, "http://$gatewayIp/")
                }

                ip in authorized -> redirect(out, "http://$gatewayIp/dashboard")

                else -> servePage(out, buildLoginPage())
            }
        } catch (e: Exception) {
            Log.d(TAG, "handle error: ${e.message}")
        } finally {
            try { sock.close() } catch (e: Exception) { /* */ }
        }
    }

    // ── response builders ───────────────────────────────────────────────────

    private fun servePage(out: OutputStream, html: String) {
        val bytes = html.toByteArray(Charsets.UTF_8)
        write(out, "HTTP/1.1 200 OK\r\nContent-Type: $MIME_HTML\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n")
        out.write(bytes)
        out.flush()
    }

    private fun serveText(out: OutputStream, text: String) {
        val bytes = text.toByteArray()
        write(out, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n")
        out.write(bytes)
        out.flush()
    }

    private fun serveStatus(out: OutputStream, ip: String) {
        val online = ip in authorized
        val json = """{"online":$online}"""
        val bytes = json.toByteArray()
        write(out, "HTTP/1.1 200 OK\r\nContent-Type: $MIME_JSON\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n")
        out.write(bytes)
        out.flush()
    }

    private fun serveFoto(out: OutputStream) {
        val bytes = config.fotoBytes
        if (bytes == null || bytes.isEmpty()) {
            write(out, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            out.flush()
            return
        }
        val mime = if (config.fotoMime.isNotEmpty()) config.fotoMime else MIME_JPEG
        write(out, "HTTP/1.1 200 OK\r\nContent-Type: $mime\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n")
        out.write(bytes)
        out.flush()
    }

    private fun redirect(out: OutputStream, location: String) {
        write(out, "HTTP/1.1 302 Found\r\nLocation: $location\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        out.flush()
    }

    private fun write(out: OutputStream, s: String) = out.write(s.toByteArray(Charsets.UTF_8))

    // ── HTML builder ────────────────────────────────────────────────────────

    private fun buildLoginPage(): String {
        val c = config
        val bg  = when (c.theme) { "black" -> "#111111"; "blue" -> "#1a56db"; else -> "#ff2d2d" }
        val acc = when (c.theme) { "black" -> "#ffffff"; "blue" -> "#ffffff"; else -> "#000000" }
        return """<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${c.pageTitle.esc()}</title>
<style>
:root{--bg:$bg;--acc:$acc}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:var(--bg);font-family:Arial,Helvetica,sans-serif}
.sc{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  opacity:0;visibility:hidden;transition:opacity .35s;background:var(--bg)}
.sc.on{opacity:1;visibility:visible}
.card{background:#fff;border:5px solid #000;box-shadow:10px 10px 0 #000;
  padding:36px 28px;text-align:center;max-width:320px;width:88%}
.card h1{margin:0 0 6px;font-size:26px;font-weight:900;text-transform:uppercase;color:#000}
.card p{margin:0 0 22px;font-size:14px;font-weight:700;color:#000}
.btn{background:var(--acc);color:var(--bg);border:4px solid var(--acc);padding:14px 40px;
  font-size:17px;font-weight:900;text-transform:uppercase;cursor:pointer;
  box-shadow:6px 6px 0 var(--bg);transition:transform .08s}
.btn:active{transform:translate(4px,4px);box-shadow:2px 2px 0 var(--bg)}
.spin{width:52px;height:52px;border:6px solid #000;background:var(--bg);
  margin:0 auto 22px;animation:spin .7s linear infinite}
@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
#hasil{background:#fff}
#hasil img{width:100%;height:100%;object-fit:contain;display:block}
</style></head><body>
<div id="login" class="sc on">
  <div class="card">
    <h1>${c.pageTitle.esc()}</h1>
    <p>${c.pageSubtitle.esc()}</p>
    <button class="btn" onclick="go()">${c.btnLabel.esc()}</button>
  </div>
</div>
<div id="conn" class="sc">
  <div class="card">
    <div class="spin"></div>
    <p id="ct">${c.connectingMsg.esc()}</p>
  </div>
</div>
<div id="hasil" class="sc">
  <img src="/foto" alt=""
    onerror="this.outerHTML='<div style=font-size:90px;text-align:center;padding-top:30vh>&#128018;</div>'">
</div>
<script>
function show(id){document.querySelectorAll('.sc').forEach(function(e){e.classList.remove('on');});
  setTimeout(function(){document.getElementById(id).classList.add('on');},200);}
function go(){
  show('conn');var s=Date.now(),t=document.getElementById('ct');
  fetch('/login',{method:'POST'}).catch(function(){}).then(function poll(){
    fetch('/status',{cache:'no-store'}).then(function(r){return r.json();})
    .then(function(j){
      if(j.online){var e=Date.now()-s;setTimeout(function(){show('hasil');},Math.max(0,1200-e));}
      else{t.textContent='${c.connectingMsg.escJs()} ('+Math.floor((Date.now()-s)/1000)+'s)';
        setTimeout(poll,800);}
    }).catch(function(){setTimeout(poll,1200);});
  });}
</script></body></html>"""
    }

    private fun String.esc() = replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
        .replace("\"","&quot;").replace("'","&#39;")
    private fun String.escJs() = replace("\\","\\\\").replace("'","\\'").replace("\n","\\n")
}

data class PrankServerConfig(
    val pageTitle: String     = "WiFi Gratis",
    val pageSubtitle: String  = "Tekan tombol di bawah untuk mulai memakai internet.",
    val btnLabel: String      = "Masuk",
    val connectingMsg: String = "Menyambungkan internet...",
    val theme: String         = "red",   // red | black | blue
    val fotoBytes: ByteArray? = null,
    val fotoMime: String      = "image/jpeg",
)
