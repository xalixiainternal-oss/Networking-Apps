package id.pantau.kuota

internal object PackageNamePolicy {
    private val pattern = Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$")

    fun isValid(packageName: String): Boolean =
        packageName.length <= 255 && pattern.matches(packageName)
}
