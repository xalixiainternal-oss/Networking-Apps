package id.pantau.kuota;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;

public class QuotaMathTest {
    private static final TimeZone[] ZONES = {
        TimeZone.getTimeZone("Asia/Jakarta"), TimeZone.getTimeZone("UTC"), TimeZone.getTimeZone("America/New_York")
    };

    private static long t(TimeZone tz, int y, int m, int d, int h) {
        Calendar c = Calendar.getInstance(tz);
        c.clear();
        c.set(y, m - 1, d, h, 0, 0);
        return c.getTimeInMillis();
    }

    @Test public void siklusSetelahTanggalReset() {
        for (TimeZone tz : ZONES) {
            long[] r = QuotaMath.cycleRange(t(tz, 2026, 10, 20, 0), 15, tz);
            assertEquals(t(tz, 2026, 10, 15, 0), r[0]);
            assertEquals(t(tz, 2026, 11, 15, 0), r[1]);
        }
    }

    @Test public void siklusSebelumTanggalReset() {
        for (TimeZone tz : ZONES) {
            long[] r = QuotaMath.cycleRange(t(tz, 2026, 10, 10, 0), 15, tz);
            assertEquals(t(tz, 2026, 9, 15, 0), r[0]);
            assertEquals(t(tz, 2026, 10, 15, 0), r[1]);
        }
    }

    @Test public void batasBawahInklusif() {
        for (TimeZone tz : ZONES)
            assertEquals(t(tz, 2026, 10, 15, 0), QuotaMath.cycleRange(t(tz, 2026, 10, 15, 0), 15, tz)[0]);
    }

    @Test public void reset31DipotongKeAkhirBulanPendek() {
        for (TimeZone tz : ZONES) {
            long[] a = QuotaMath.cycleRange(t(tz, 2026, 2, 27, 12), 31, tz);
            assertEquals(t(tz, 2026, 1, 31, 0), a[0]);
            assertEquals(t(tz, 2026, 2, 28, 0), a[1]);
            long[] b = QuotaMath.cycleRange(t(tz, 2026, 2, 28, 12), 31, tz);
            assertEquals(t(tz, 2026, 2, 28, 0), b[0]);
            assertEquals(t(tz, 2026, 3, 31, 0), b[1]);
        }
    }

    @Test public void lintasTahun() {
        for (TimeZone tz : ZONES) {
            long[] a = QuotaMath.cycleRange(t(tz, 2026, 1, 5, 0), 20, tz);
            assertEquals(t(tz, 2025, 12, 20, 0), a[0]);
            assertEquals(t(tz, 2026, 1, 20, 0), a[1]);
            long[] b = QuotaMath.cycleRange(t(tz, 2026, 12, 25, 0), 20, tz);
            assertEquals(t(tz, 2026, 12, 20, 0), b[0]);
            assertEquals(t(tz, 2027, 1, 20, 0), b[1]);
        }
    }

    @Test public void jamMalamMelewatiTengahMalam() {
        for (TimeZone tz : ZONES) {
            assertTrue(QuotaMath.isNightHour(t(tz, 2026, 10, 10, 23), 22, 6, tz));
            assertTrue(QuotaMath.isNightHour(t(tz, 2026, 10, 10, 3), 22, 6, tz));
            assertFalse(QuotaMath.isNightHour(t(tz, 2026, 10, 10, 6), 22, 6, tz));
            assertFalse(QuotaMath.isNightHour(t(tz, 2026, 10, 10, 21), 22, 6, tz));
            assertFalse(QuotaMath.isNightHour(t(tz, 2026, 10, 10, 5), 5, 5, tz));
        }
    }

    @Test public void ambangPeringatan() {
        assertEquals(0, QuotaMath.levelFor(79.99));
        assertEquals(80, QuotaMath.levelFor(80));
        assertEquals(80, QuotaMath.levelFor(89.9));
        assertEquals(90, QuotaMath.levelFor(90));
        assertEquals(90, QuotaMath.levelFor(99.99));
        assertEquals(100, QuotaMath.levelFor(100));
        assertEquals(100, QuotaMath.levelFor(250));
    }

    @Test public void persenDanKuotaMalam() {
        assertEquals(25.0, QuotaMath.percent(50, 200), 0.0001);
        assertEquals(0.0, QuotaMath.percent(5, 0), 0.0001);
        assertEquals(700L, QuotaMath.mainUsed(1000, 300, 500));
        assertEquals(500L, QuotaMath.mainUsed(1000, 800, 500));
        assertEquals(1000L, QuotaMath.mainUsed(1000, 300, 0));
        assertEquals(0L, QuotaMath.mainUsed(100, 300, 500));
    }

    @Test public void formatByte() {
        assertEquals("999 B", QuotaMath.fmtBytes(999, 1000));
        assertEquals("1,00 MiB", QuotaMath.fmtBytes(1_048_576, 1024));
        assertEquals("2,50 MB/s", QuotaMath.fmtSpeed(2_500_000, 1000));
    }

    @Test public void langkahPeringatanSetelahBatasHarian() {
        long q = 1_000_000_000L, step = 200_000_000L;
        assertEquals(0L, QuotaMath.overSteps(999_999_999L, q, step));
        assertEquals(0L, QuotaMath.overSteps(q, q, step));
        assertEquals(0L, QuotaMath.overSteps(1_199_999_999L, q, step));
        assertEquals(1L, QuotaMath.overSteps(1_200_000_000L, q, step));
        assertEquals(2L, QuotaMath.overSteps(1_450_000_000L, q, step));
        assertEquals(0L, QuotaMath.overSteps(5L * q, 0L, step));
        assertEquals(0L, QuotaMath.overSteps(5L * q, q, 0L));
    }

    @Test public void pemutusanData() {
        long q = 1_000_000_000L;
        assertFalse(QuotaMath.cutoffReached(2L * q, q, 0L));
        assertFalse(QuotaMath.cutoffReached(2L * q, 0L, 400_000_000L));
        assertFalse(QuotaMath.cutoffReached(1_399_999_999L, q, 400_000_000L));
        assertTrue(QuotaMath.cutoffReached(1_400_000_000L, q, 400_000_000L));
    }
}
