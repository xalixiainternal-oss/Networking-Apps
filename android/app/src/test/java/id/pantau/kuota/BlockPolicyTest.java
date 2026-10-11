package id.pantau.kuota;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import id.pantau.kuota.BlockPolicy.Rule;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
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
}
