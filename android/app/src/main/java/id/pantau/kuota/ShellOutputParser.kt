package id.pantau.kuota

/**
 * Membaca keluaran perintah `cmd connectivity get-*` yang formatnya bisa beda antar-versi/OEM.
 * Mengembalikan null bila tidak yakin, supaya pemanggil memilih jalur aman (kembali ke VPN).
 */
internal object ShellOutputParser {
    private val negated = Regex("\\bnot\\s+(allowed|enabled|permitted)\\b")
    private val failure = Regex("(unknown command|exception|error:|unsupported|invalid argument)")
    private val word = Regex("[a-z]+")
    private val yes = setOf("allow", "allowed", "enabled", "true", "on")
    private val no = setOf("deny", "denied", "disabled", "false", "blocked", "block", "off")

    fun parseEnabled(raw: String): Boolean? {
        val line = raw.lineSequence().map { it.trim().lowercase() }.lastOrNull { it.isNotEmpty() } ?: return null
        if (failure.containsMatchIn(line)) return null
        if (negated.containsMatchIn(line)) return false
        val token = word.findAll(line).map { it.value }.lastOrNull() ?: return null
        return when (token) {
            in yes -> true
            in no -> false
            else -> null
        }
    }
}
