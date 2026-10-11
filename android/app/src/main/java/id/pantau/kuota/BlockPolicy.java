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

    public static final class Rule {
        public final String pkg;
        public final String label;
        public final boolean cell;       // blokir saat jaringan aktif = seluler
        public final boolean wifi;       // blokir saat jaringan aktif = Wi-Fi
        public final boolean bg;         // blokir kapan pun aplikasinya tidak sedang di layar
        public final boolean autoBlock;  // boleh diblokir otomatis saat batas aplikasi terlewati (sudah disetujui pengguna)

        public Rule(String pkg, String label, boolean cell, boolean wifi, boolean bg, boolean autoBlock) {
            this.pkg = pkg; this.label = label; this.cell = cell; this.wifi = wifi; this.bg = bg; this.autoBlock = autoBlock;
        }
    }

    /**
     * @param net         "cell" | "wifi" | "other" (tidak ada jaringan / Ethernet / tidak diketahui)
     * @param foreground  paket yang sedang di layar, atau null bila tidak diketahui
     * @param screenOn    layar menyala? Layar mati = semua aplikasi dianggap background
     * @param autoBlocked paket -> waktu (ms) blokir otomatis berakhir
     * @param ownPkg      paket aplikasi ini; TIDAK PERNAH diblokir
     * @return himpunan terurut (stabil, mudah dibandingkan) paket yang harus diblokir
     */
    public static Set<String> blockedSet(List<Rule> rules, String net, String foreground, boolean screenOn,
                                         Map<String, Long> autoBlocked, long now, String ownPkg) {
        Set<String> out = new TreeSet<>();
        for (Rule r : rules) {
            if (r.pkg == null || r.pkg.isEmpty() || r.pkg.equals(ownPkg)) continue;
            boolean block = false;
            Long until = autoBlocked == null ? null : autoBlocked.get(r.pkg);
            if (until != null && until > now) block = true;
            if ("cell".equals(net) && r.cell) block = true;
            if ("wifi".equals(net) && r.wifi) block = true;
            if (r.bg) {
                boolean onScreen = screenOn && r.pkg.equals(foreground);
                if (!onScreen) block = true;
            }
            if (block) out.add(r.pkg);
        }
        return Collections.unmodifiableSet(out);
    }
}
