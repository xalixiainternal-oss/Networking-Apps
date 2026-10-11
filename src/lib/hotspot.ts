import { useCallback, useEffect, useState } from 'react';
import { Quota, type Capabilities, type HotspotState, type TetherRow } from './quotaPlugin';
import { ensureAppSync } from './appUsage';
import { DAY, HOUR, addLocalDays, startOfLocalDay, type Bytes } from './usage';

export type { TetherRow };

export function sumTether(rows: TetherRow[], from: number, to: number): Bytes {
  let rx = 0, tx = 0;
  for (const r of rows) if (r.t >= from && r.t < to) { rx += r.rx; tx += r.tx; }
  return { rx, tx };
}

export interface HotBucket { t: number; rx: number; tx: number; total: number }

/** Deret bucket tetap (jam atau hari lokal); nol bila kosong. Total seluruh bucket = jumlah baris di rentangnya. */
export function tetherSeries(rows: TetherRow[], start: number, count: number, gran: 'hour' | 'day'): HotBucket[] {
  const starts = Array.from({ length: count + 1 }, (_, i) => (gran === 'hour' ? start + i * HOUR : addLocalDays(start, i)));
  return starts.slice(0, count).map((t, i) => {
    const s = sumTether(rows, t, starts[i + 1]);
    return { t, rx: s.rx, tx: s.tx, total: s.rx + s.tx };
  });
}

/** Sinkron data per-aplikasi/tethering lalu baca 35 hari dari Room; segarkan tiap 2 menit saat layar terlihat. */
export function useTether() {
  const [rows, setRows] = useState<TetherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    try {
      const info = await ensureAppSync(force ? 0 : 120_000, force);
      setNote(info.ok ? null : info.message ?? 'Data hotspot belum bisa dibaca.');
      const to = Date.now() + HOUR;
      const r = await Quota.getTetherHours({ from: startOfLocalDay(to) - 35 * DAY, to });
      setRows(r.rows);
    } catch (e) { setNote(String((e as Error).message ?? e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 120_000);
    return () => clearInterval(id);
  }, [load]);
  return { rows, loading, note, reload: () => load(true) };
}

/** Status hotspot (perkiraan) — dicek ulang tiap 5 detik selama halaman terbuka. */
export function useHotspotState() {
  const [st, setSt] = useState<HotspotState | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => { if (document.visibilityState === 'visible') Quota.getHotspotState().then((s) => { if (alive) setSt(s); }).catch(() => { if (alive) setSt(null); }); };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return st;
}

export function useCapabilities() {
  const [c, setC] = useState<Capabilities | null>(null);
  useEffect(() => { Quota.getCapabilities().then(setC).catch(() => setC(null)); }, []);
  return c;
}

export const HOTSPOT_KIND_LABEL: Record<HotspotState['kind'], string> = {
  wifi: 'Hotspot Wi-Fi', usb: 'Tethering USB', bluetooth: 'Tethering Bluetooth', none: 'Tidak terdeteksi',
};
