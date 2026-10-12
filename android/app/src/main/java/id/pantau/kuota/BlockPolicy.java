package id.pantau.kuota;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Logika murni (tanpa API Android): paket mana yang harus diblokir SEKARANG.
 * Dipisah dari VpnService supaya bisa diuji di JVM biasa.
 */
public final class BlockPolicy {
    private BlockPolicy() {}
    private static final int PER_USER_RANGE = 100000;

    /** UID appId sama pada profil Android berbeda; UID di bawah 100000 sudah dalam bentuk appId. */
    public static int appIdOfUid(int uid) {
        return uid >= PER_USER_RANGE ? uid % PER_USER_RANGE : uid;
    }

    public static boolean isWithinSchedule(int startMinute, int endMinute, int currentMinute) {
        if (startMinute == endMinute) return false;
        return startMinute < endMinute
            ? currentMinute >= startMinute && currentMinute < endMinute
            : currentMinute >= startMinute || currentMinute < endMinute;
    }

    public static final class Rule {
        public final String pkg;
        public final String label;
        public final boolean cell;       // blokir saat jaringan aktif = seluler
        public final boolean wifi;       // blokir saat jaringan aktif = Wi-Fi
        public final boolean bg;         // blokir kapan pun aplikasinya tidak sedang di layar
        public final boolean autoBlock;  // boleh diblokir otomatis saat batas aplikasi terlewati (sudah disetujui pengguna)
        public final boolean hot;        // blokir selama hotspot/tethering HP ini menyala (menghemat kuota yang dibagikan)

        public Rule(String pkg, String label, boolean cell, boolean wifi, boolean bg, boolean autoBlock, boolean hot) {
            this.pkg = pkg; this.label = label; this.cell = cell; this.wifi = wifi; this.bg = bg; this.autoBlock = autoBlock; this.hot = hot;
        }

        public Rule(String pkg, String label, boolean cell, boolean wifi, boolean bg, boolean autoBlock) {
            this(pkg, label, cell, wifi, bg, autoBlock, false);
        }
    }

    /**
     * @param net         "cell" | "wifi" | "other" (tidak ada jaringan / Ethernet / tidak diketahui)
     * @param foreground  paket yang sedang di layar, atau null bila tidak diketahui
     * @param screenOn    layar menyala? Layar mati = semua aplikasi dianggap background
     * @param autoBlocked paket -> waktu (ms) blokir otomatis berakhir
     * @param ownPkg      paket aplikasi ini; TIDAK PERNAH diblokir
     * @param hotspotOn   hotspot/tethering HP ini menyala? (hanya memengaruhi aturan dengan hot = true)
     * @return himpunan terurut (stabil, mudah dibandingkan) paket yang harus diblokir
     */
    public static Set<String> blockedSet(List<Rule> rules, String net, String foreground, boolean screenOn,
                                         Map<String, Long> autoBlocked, long now, String ownPkg) {
        return blockedSet(rules, net, foreground, screenOn, autoBlocked, now, ownPkg, false);
    }

    /** Sama seperti di atas, ditambah {@code hotspotOn}: hotspot/tethering HP ini sedang menyala. */
    public static Set<String> blockedSet(List<Rule> rules, String net, String foreground, boolean screenOn,
                                         Map<String, Long> autoBlocked, long now, String ownPkg, boolean hotspotOn) {
        return blockedSet(rules, net, foreground, screenOn, autoBlocked, now, ownPkg, hotspotOn, Collections.emptyMap());
    }

    /**
     * Variant yang digunakan bila beberapa nama paket berbagi UID. Seluruh paket dengan UID yang sama harus
     * masuk VPN bersama karena statistik dan isolasi jaringan Android berlaku pada tingkat UID.
     */
    public static Set<String> blockedSet(List<Rule> rules, String net, String foreground, boolean screenOn,
                                         Map<String, Long> autoBlocked, long now, String ownPkg, boolean hotspotOn,
                                         Map<String, Set<String>> packageAliases) {
        Set<String> out = new TreeSet<>();
        for (Rule r : rules) {
            if (r.pkg == null || r.pkg.isEmpty() || r.pkg.equals(ownPkg)) continue;
            boolean block = false;
            Long until = autoBlocked == null ? null : autoBlocked.get(r.pkg);
            if (until != null && until > now) block = true;
            if ("cell".equals(net) && r.cell) block = true;
            if ("wifi".equals(net) && r.wifi) block = true;
            if (hotspotOn && r.hot) block = true;
            if (r.bg) {
                boolean onScreen = screenOn && r.pkg.equals(foreground);
                if (!onScreen) block = true;
            }
            if (block) {
                out.add(r.pkg);
                Set<String> aliases = packageAliases == null ? null : packageAliases.get(r.pkg);
                if (aliases != null) {
                    for (String alias : aliases) {
                        if (alias != null && !alias.isEmpty() && !alias.equals(ownPkg)) out.add(alias);
                    }
                }
            }
        }
        return Collections.unmodifiableSet(out);
    }
}
