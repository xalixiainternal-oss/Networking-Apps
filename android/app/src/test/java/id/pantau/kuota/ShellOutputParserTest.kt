package id.pantau.kuota

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShellOutputParserTest {
    @Test
    fun readsCommonAllowDenyFormats() {
        assertEquals(true, ShellOutputParser.parseEnabled("com.example.app: allow"))
        assertEquals(false, ShellOutputParser.parseEnabled("com.example.app: deny\n"))
        assertEquals(true, ShellOutputParser.parseEnabled("Package networking is enabled"))
        assertEquals(false, ShellOutputParser.parseEnabled("Package networking is disabled"))
        assertEquals(true, ShellOutputParser.parseEnabled("true"))
        assertEquals(false, ShellOutputParser.parseEnabled("false\n\n"))
    }

    @Test
    fun negationWins() {
        assertEquals(false, ShellOutputParser.parseEnabled("network is not allowed"))
        assertEquals(false, ShellOutputParser.parseEnabled("chain not enabled"))
    }

    @Test
    fun unknownOrEmptyIsNull() {
        assertNull(ShellOutputParser.parseEnabled(""))
        assertNull(ShellOutputParser.parseEnabled("  \n "))
        assertNull(ShellOutputParser.parseEnabled("Unknown command: get-chain3-enabled"))
        assertNull(ShellOutputParser.parseEnabled("123"))
    }
}
