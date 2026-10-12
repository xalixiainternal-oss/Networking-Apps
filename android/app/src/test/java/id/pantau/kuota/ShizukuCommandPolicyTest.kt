package id.pantau.kuota

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShizukuCommandPolicyTest {
    @Test
    fun packageFirewallUsesSeparateValidatedArguments() {
        assertEquals(true, PackageNamePolicy.isValid("com.example.app"))
        assertEquals(false, PackageNamePolicy.isValid("com.example;id"))
        assertEquals(
            listOf("cmd", "connectivity", "set-package-networking-enabled", "false", "com.example.app"),
            ShellCommandPolicy.build(ShellOperation.SET_PACKAGE_NETWORKING, 10_123, "com.example.app", false, 34)
        )
        assertNull(ShellCommandPolicy.build(
            ShellOperation.SET_PACKAGE_NETWORKING, 10_123, "com.example.app;id", false, 34
        ))
    }

    @Test
    fun rejectsUnsupportedVersionsAndInvalidUids() {
        assertNull(ShellCommandPolicy.build(
            ShellOperation.SET_PACKAGE_NETWORKING, 10_123, "com.example.app", false, 32
        ))
        assertNull(ShellCommandPolicy.build(
            ShellOperation.FORCE_STOP, 9_999, "com.example.app", false, 34
        ))
        assertNull(ShellCommandPolicy.build(999, 0, "", false, 34))
    }

    @Test
    fun sensitiveOperationsAreAllowlistedAndArgumentsRemainAtomic() {
        assertEquals(
            listOf("dumpsys", "deviceidle", "whitelist", "+com.example.app"),
            ShellCommandPolicy.build(ShellOperation.GRANT_PERMISSION, 3, "com.example.app", false, 34)
        )
        assertNull(ShellCommandPolicy.build(ShellOperation.GRANT_PERMISSION, 99, "com.example.app", false, 34))
        assertEquals(
            listOf("svc", "data", "disable"),
            ShellCommandPolicy.build(ShellOperation.MOBILE_DATA, 0, "", false, 34)
        )
        assertEquals(
            listOf("cmd", "connectivity", "get-chain3-enabled"),
            ShellCommandPolicy.build(ShellOperation.GET_CHAIN3_STATE, 0, "", false, 34)
        )
        assertEquals(
            listOf("cmd", "connectivity", "get-package-networking-enabled", "com.example.app"),
            ShellCommandPolicy.build(ShellOperation.GET_PACKAGE_NETWORKING, 10_123, "com.example.app", false, 34)
        )
    }
}
