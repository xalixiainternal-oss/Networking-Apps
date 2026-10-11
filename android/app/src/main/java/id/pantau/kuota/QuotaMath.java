package id.pantau.kuota;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Logika murni (tanpa API Android) supaya bisa diuji di JVM biasa.
 * Cermin dari cycleRange / percent di src/lib/usage.ts.
 */
public final class QuotaMath {
    private QuotaMath() {}

    public static final long HOUR = 3_600_000L;

    private static int daysInMonth(int year, int month0) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(year, month0, 1);
        return c.getActualMaximum(Calendar.DAY_OF_MONTH);
    }

    private static long at(TimeZone tz, int year, int month0, int resetDay) {
        // month0 boleh -1 atau 12: Calendar menormalkan sendiri.
        Calendar norm = Calendar.getInstance(tz);
        norm.clear();
        norm.set(year, month0, 1);
        int y = norm.get(Calendar.YEAR), m = norm.get(Calendar.MONTH);
        int day = Math.min(Math.max(1, resetDay), daysInMonth(y, m));
        Calendar c = Calendar.getInstance(tz);
        c.clear();
        c.set(y, m, day, 0, 0, 0);
        return c.getTimeInMillis();
    }

    /** Awal siklus tagihan [start, end) yang memuat {@code now}. Hasil: {start, end}. */
    public static long[] cycleRange(long now, int resetDay, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(now);
        int y = c.get(Calendar.YEAR), m = c.get(Calendar.MONTH);
        long thisReset = at(tz, y, m, resetDay);
        if (now >= thisReset) return new long[]{thisReset, at(tz, y, m + 1, resetDay)};
        return new long[]{at(tz, y, m - 1, resetDay), thisReset};
    }

    public static long startOfDay(long now, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Apakah jam yang dimulai pada hourStart termasuk jendela kuota malam [startH, endH)? Boleh melewati tengah malam. */
    public static boolean isNightHour(long hourStart, int startH, int endH, TimeZone tz) {
        if (startH == endH) return false;
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(hourStart);
        int h = c.get(Calendar.HOUR_OF_DAY);
        if (startH < endH) return h >= startH && h < endH;
        return h >= startH || h < endH;
    }

    public static double percent(long used, long quota) {
        return quota <= 0 ? 0.0 : (used * 100.0) / quota;
    }

    /** 0 = aman, 80 / 90 / 100 = ambang peringatan tertinggi yang sudah terlewati. */
    public static int levelFor(double pct) {
        if (pct >= 100.0) return 100;
        if (pct >= 90.0) return 90;
        if (pct >= 80.0) return 80;
        return 0;
    }

    /**
     * Pemakaian seluler yang dihitung ke kuota utama. Pemakaian di jam malam dihitung dulu ke kuota malam
     * (sebesar-besarnya sebesar kuota malam); sisanya tumpah ke kuota utama.
     */
    public static long mainUsed(long cellTotal, long nightUsed, long nightQuota) {
        if (nightQuota <= 0) return cellTotal;
        return Math.max(0L, cellTotal - Math.min(nightUsed, nightQuota));
    }

    public static String fmtBytes(long n, int base) {
        String[] u = base == 1024
                ? new String[]{"B", "KiB", "MiB", "GiB", "TiB"}
                : new String[]{"B", "KB", "MB", "GB", "TB"};
        double v = Math.max(0L, n);
        int i = 0;
        while (v >= base && i < u.length - 1) { v /= base; i++; }
        if (i == 0) return String.format(Locale.forLanguageTag("id-ID"), "%.0f %s", v, u[i]);
        return String.format(Locale.forLanguageTag("id-ID"), "%.2f %s", v, u[i]);
    }

    public static String fmtSpeed(long bytesPerSec, int base) {
        return fmtBytes(bytesPerSec, base) + "/s";
    }
}
