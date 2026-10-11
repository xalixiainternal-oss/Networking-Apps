import { useCallback, useEffect, useRef, useState } from 'react';
import { Quota, type SyncInfo } from './quotaPlugin';
import { DAY, startOfLocalDay, type HourRow } from './usage';

/** Sinkron + baca 35 hari jam-an dari Room; segarkan tiap menit selama layar terlihat. */
export function useHours() {
  const [rows, setRows] = useState<HourRow[]>([]);
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const i = await Quota.syncNow(); setInfo(i);
      const to = Date.now() + 3_600_000;
      const r = await Quota.getHours({ from: startOfLocalDay(to) - 35 * DAY, to });
      setRows(r.rows);
    } catch (e) { setInfo({ ok: false, rows: 0, mobileSupported: false, sdk: 0, message: String((e as Error).message ?? e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);
  return { rows, info, loading, reload: load };
}

/** Kecepatan real-time: sampling TrafficStats tiap 1 detik hanya saat layar aktif. */
export function useSpeed() {
  const [sp, setSp] = useState<{ down: number; up: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const prev = useRef<{ rx: number; tx: number; t: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== 'visible') { prev.current = null; return; }
      try {
        const n = await Quota.getTrafficTotals(), t = performance.now(), p = prev.current;
        if (p && alive) { const dt = (t - p.t) / 1000; setSp({ down: Math.max(0, (n.rx - p.rx) / dt), up: Math.max(0, (n.tx - p.tx) / dt) }); }
        prev.current = { ...n, t };
      } catch (e) { if (alive) setErr(String((e as Error).message ?? e)); }
    };
    const id = setInterval(tick, 1000); tick();
    return () => { alive = false; clearInterval(id); };
  }, []);
  return { speed: sp, error: err };
}

/** Jam sekarang yang diperbarui berkala, supaya useMemo tidak dihitung ulang di setiap render. */
export function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
