package id.pantau.kuota;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import id.pantau.kuota.BlockPolicy.Rule;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.Test;

public class BlockPolicyTest {
    private static Set<String> s(String... x) { return new TreeSet<>(Arrays.asList(x)); }

    private final List<Rule> rules = Arrays.asList(
        new Rule("a", "A", true, false, false, false),
        new Rule("b", "B", false, true, false, false),
        new Rule("c", "C", false, false, true, false),
        new Rule("d", "D", true, true, false, true),
        new Rule("me", "Aku", true, true, true, true));
    private final Map<String, Long> none = new HashMap<>();

    @Test public void aturanPerJaringan() {
        assertEquals(s("a", "c", "d"), BlockPolicy.blockedSet(rules, "cell", "x", true, none, 1000, "me"));
        assertEquals(s("b", "c", "d"), BlockPolicy.blockedSet(rules, "wifi", "x", true, none, 1000, "me"));
        assertEquals(s("c"), BlockPolicy.blockedSet(rules, "other", "x", true, none, 1000, "me"));
    }

    @Test public void backgroundMengikutiLayarDanAplikasiDiDepan() {
        assertEquals(s("b", "d"), BlockPolicy.blockedSet(rules, "wifi", "c", true, none, 1000, "me"));
        assertEquals(s("b", "c", "d"), BlockPolicy.blockedSet(rules, "wifi", "c", false, none, 1000, "me"));
        assertEquals(s("b", "c", "d"), BlockPolicy.blockedSet(rules, "wifi", null, true, none, 1000, "me"));
    }

    @Test public void blokirOtomatisBerakhir() {
        Map<String, Long> auto = new HashMap<>();
        auto.put("b", 5000L);
        auto.put("c", 500L);
        assertEquals(s("a", "b", "d"), BlockPolicy.blockedSet(rules, "cell", "c", true, auto, 1000, "me"));
        assertEquals(s("a", "d"), BlockPolicy.blockedSet(rules, "cell", "c", true, auto, 6000, "me"));
    }

    @Test public void tidakPernahMemblokirDiriSendiri() {
        assertFalse(BlockPolicy.blockedSet(rules, "cell", null, false, null, 1000, "me").contains("me"));
        assertEquals(s(), BlockPolicy.blockedSet(new ArrayList<Rule>(), "cell", null, true, none, 1000, "me"));
    }

    @Test public void blokirSaatHotspotMenyalaHanyaUntukAturanHot() {
        List<Rule> r = Arrays.asList(
            new Rule("h", "H", false, false, false, false, true),
            new Rule("a", "A", true, false, false, false, false),
            new Rule("me", "Aku", false, false, false, false, true));
        assertEquals(s("a", "h"), BlockPolicy.blockedSet(r, "cell", "x", true, none, 1000, "me", true));
        assertEquals(s("a"), BlockPolicy.blockedSet(r, "cell", "x", true, none, 1000, "me", false));
        // jalur lama (tanpa parameter hotspot) = hotspot mati
        assertEquals(s("a"), BlockPolicy.blockedSet(r, "cell", "x", true, none, 1000, "me"));
        // tidak bergantung jenis jaringan, dan tidak pernah memblokir diri sendiri
        assertEquals(s("h"), BlockPolicy.blockedSet(r, "wifi", "x", true, none, 1000, "me", true));
    }

    @Test public void identitasAplikasiSamaPadaProfilBerbeda() {
        assertEquals(10123, BlockPolicy.appIdOfUid(1010123));
        assertEquals(10123, BlockPolicy.appIdOfUid(2010123));
        assertEquals(10123, BlockPolicy.appIdOfUid(10123));
        assertEquals(1000, BlockPolicy.appIdOfUid(101000));
    }

    @Test public void paketSatuUidIkutMasukVpnBersamaPaketAturan() {
        Map<String, Set<String>> aliases = Collections.singletonMap("a", s("a", "a.shared"));
        // rules juga berisi c (bg, tidak di layar) dan d (seluler), jadi ikut terblokir; yang diuji: alias a ikut masuk.
        assertEquals(s("a", "a.shared", "c", "d"),
            BlockPolicy.blockedSet(rules, "cell", "x", true, none, 1000, "me", false, aliases));
    }

    @Test public void jadwalMendukungLintasTengahMalamDenganAkhirEksklusif() {
        assertFalse(BlockPolicy.isWithinSchedule(8 * 60, 15 * 60, 7 * 60 + 59));
        assertTrue(BlockPolicy.isWithinSchedule(8 * 60, 15 * 60, 8 * 60));
        assertTrue(BlockPolicy.isWithinSchedule(8 * 60, 15 * 60, 14 * 60 + 59));
        assertFalse(BlockPolicy.isWithinSchedule(8 * 60, 15 * 60, 15 * 60));
        assertTrue(BlockPolicy.isWithinSchedule(22 * 60, 6 * 60, 23 * 60));
        assertTrue(BlockPolicy.isWithinSchedule(22 * 60, 6 * 60, 5 * 60 + 59));
        assertFalse(BlockPolicy.isWithinSchedule(22 * 60, 6 * 60, 6 * 60));
        assertFalse(BlockPolicy.isWithinSchedule(8 * 60, 8 * 60, 8 * 60));
    }
}
