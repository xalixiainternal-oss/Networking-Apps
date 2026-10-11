/**
 * appUsage.ts — logika bisnis per-aplikasi
 * Dipisah dari usage.ts agar tidak membuat Dashboard ikut-ikutan berat.
 */
import { useSyncExternalStore, useCallback, useEffect, useRef, useState } from 'react';
import { Quota, type AppInfoItem, type AppSummaryItem, type AppHourRow, type SyncInfo, type TetherRow } from './quotaPlugin';
import { DAY, HOUR, startOfLocalDay, addLocalDays, fmtBytes, cycleRange, type HourRow } from './usage';

// ─── tipe publik ─────────────────────────────────────────────────────────────

export type { AppSummaryItem, AppInfoItem, AppHourRow } from './quotaPlugin';

export interface AppRow {
  uid: number;
  packageName: string;
  label: string;
  isSystem: boolean;
  rx: number; tx: number;
  rxCell: number; txCell: number;
  rxWifi: number; txWifi: number;
  total: number;
  pct: number;        // persentase dari total semua aplikasi
}

export type SortKey = 'total' | 'rx' | 'tx' | 'label';
export type NetFilter = 'semua' | 'cell' | 'wifi';
export type Period = 'hari-ini' | 'kemarin' | '7-hari' | '30-hari' | 'siklus' | 'kustom';

export interface PeriodRange { label: string; from: number; to: number }

export function periodRange(p: Period, resetDay: number, now = Date.now(), customFrom?: number, customTo?: number): PeriodRange {
  const t0 = startOfLocalDay(now);
  switch (p) {
    case 'hari-ini':  return { label: 'Hari ini',    from: t0,                       to: now + HOUR };
    case 'kemarin':   return { label: 'Kemarin',     from: addLocalDays(t0, -1),     to: t0 };
    case '7-hari':    return { label: '7 hari',      from: addLocalDays(t0, -6),     to: now + HOUR };
    case '30-hari':   return { label: '30 hari',     from: addLocalDays(t0, -29),    to: now + HOUR };
    case 'siklus': {
      const cyc = cycleRange(now, resetDay);
      return { label: 'Siklus tagihan', from: cyc.start, to: cyc.end };
    }
    case 'kustom': {
      const from = customFrom ?? addLocalDays(t0, -6);
      // `customTo` adalah awal HARI terakhir yang dipilih; ujung rentang eksklusif = awal hari berikutnya.
      const to = customTo !== undefined ? addLocalDays(startOfLocalDay(customTo), 1) : now + HOUR;
      return { label: 'Kustom', from, to: Math.max(to, from + HOUR) };
    }
  }
}

// ─── penggabung summary + info ────────────────────────────────────────────────

export function mergeAppData(
  summaryRows: AppSummaryItem[],
  infoList: AppInfoItem[],
  netFilter: NetFilter,
): AppRow[] {
  const infoMap = new Map<number, AppInfoItem>(infoList.map(i => [i.uid, i]));

  const rows: AppRow[] = summaryRows.map(s => {
    const info = infoMap.get(s.uid);
    let rx = 0, tx = 0;
    if (netFilter === 'semua') { rx = s.rx; tx = s.tx; }
    else if (netFilter === 'cell') { rx = s.rxCell; tx = s.txCell; }
    else { rx = s.rxWifi; tx = s.txWifi; }
    return {
      uid: s.uid,
      packageName: info?.packageName ?? `uid:${s.uid}`,
      label: info?.label ?? `UID ${s.uid}`,
      isSystem: (info?.isSystem ?? 0) === 1,
      rx, tx,
      rxCell: s.rxCell, txCell: s.txCell,
      rxWifi: s.rxWifi, txWifi: s.txWifi,
      total: rx + tx,
      pct: 0, // dihitung setelah total diketahui
    };
  });

  const grandTotal = rows.reduce((a, r) => a + r.total, 0);
  rows.forEach(r => { r.pct = grandTotal > 0 ? (r.total / grandTotal) * 100 : 0; });
  return rows;
}

export function sortRows(rows: AppRow[], key: SortKey): AppRow[] {
  return [...rows].sort((a, b) => {
    if (key === 'label') return a.label.localeCompare(b.label, 'id');
    if (key === 'rx')    return b.rx - a.rx;
    if (key === 'tx')    return b.tx - a.tx;
    return b.total - a.total;
  });
}

// ─── bucket per-jam/hari untuk grafik detail aplikasi ────────────────────────

export interface AppBucket { t: number; cell: number; wifi: number }

export function appBucketSeries(
  rows: AppHourRow[],
  start: number,
  count: number,
  gran: 'hour' | 'day',
): AppBucket[] {
  const ends = Array.from({ length: count + 1 }, (_, i) =>
    gran === 'hour' ? start + i * HOUR : addLocalDays(start, i));
  return ends.slice(0, count).map((t, i) => {
    let cell = 0, wifi = 0;
    for (const r of rows) {
      if (r.t >= t && r.t < ends[i + 1]) {
        if (r.net === 'cell') cell += r.rx + r.tx;
        else wifi += r.rx + r.tx;
      }
    }
    return { t, cell, wifi };
  });
}

// ─── sinkron per-aplikasi: satu pintu, tidak menumpuk, dibatasi frekuensinya ─────

let appSyncAt = 0;
let appSyncInfo: SyncInfo | null = null;
let appSyncP: Promise<SyncInfo> | null = null;

/** Jalankan sinkron per-aplikasi/hotspot kecuali baru saja dilakukan (maxAgeMs). Panggilan bersamaan berbagi satu proses. */
export function ensureAppSync(maxAgeMs = 120_000, force = false): Promise<SyncInfo> {
  if (appSyncP) return appSyncP;
  if (!force && appSyncInfo && Date.now() - appSyncAt < maxAgeMs) return Promise.resolve(appSyncInfo);
  appSyncP = Quota.syncAppsNow()
    .then((i) => { appSyncInfo = i; appSyncAt = Date.now(); return i; })
    .finally(() => { appSyncP = null; });
  return appSyncP;
}

// ─── ikon cache (Map uid → base64) ───────────────────────────────────────────

type IconCache = Map<string, string>;
let iconCache: IconCache = new Map();
const iconSubs = new Set<() => void>();

function getIconCache(): IconCache { return iconCache; }
function subIcons(fn: () => void) { iconSubs.add(fn); return () => iconSubs.delete(fn); }

export function useIconCache(): IconCache {
  return useSyncExternalStore(subIcons, getIconCache);
}

export async function loadIcon(pkg: string): Promise<void> {
  if (!pkg || iconCache.has(pkg)) return;
  iconCache = new Map(iconCache).set(pkg, ''); // tandai sedang dimuat
  iconSubs.forEach(f => f());
  try {
    const { base64 } = await Quota.getAppIcon({ packageName: pkg });
    iconCache = new Map(iconCache).set(pkg, base64);
    iconSubs.forEach(f => f());
  } catch { /* icon tidak ada: biarkan kosong */ }
}

// ─── hook utama: daftar aplikasi ─────────────────────────────────────────────

export interface UseAppsResult {
  rows: AppRow[];
  /** Total sistem (semua aplikasi + tethering + lainnya) untuk rentang & jaringan yang sama. */
  deviceTotal: number;
  /** Total tethering/hotspot pada rentang & jaringan yang sama (bagian dari total sistem, bukan dari aplikasi). */
  tetherTotal: number;
  loading: boolean;
  syncing: boolean;
  syncInfo: SyncInfo | null;
  reload(): void;
}

export function useApps(range: PeriodRange, netFilter: NetFilter, sort: SortKey): UseAppsResult {
  const [summaryRows, setSummaryRows] = useState<AppSummaryItem[]>([]);
  const [infoList, setInfoList] = useState<AppInfoItem[]>([]);
  const [hours, setHours] = useState<HourRow[]>([]);
  const [tether, setTether] = useState<TetherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);

  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = rangeRef.current;
      const [sumRes, infoRes, hourRes, tetherRes] = await Promise.all([
        Quota.getAppSummary({ from, to }),
        Quota.getAppInfoList(),
        Quota.getHours({ from, to }),
        Quota.getTetherHours({ from, to }),
      ]);
      setSummaryRows(sumRes.rows);
      setInfoList(infoRes.rows);
      setHours(hourRes.rows);
      setTether(tetherRes.rows);
    } catch { /* biarkan data lama; pesan galat tampil lewat syncInfo */ }
    finally { setLoading(false); }
  }, []);

  const sync = useCallback(async (force: boolean) => {
    setSyncing(true);
    try { setSyncInfo(await ensureAppSync(120_000, force)); }
    catch (e) { setSyncInfo({ ok: false, rows: 0, mobileSupported: false, sdk: 0, message: String((e as Error).message ?? e) }); }
    finally { setSyncing(false); }
    await load();
  }, [load]);

  const reload = useCallback(() => { void sync(true); }, [sync]);

  // Buka tab → sinkron otomatis (sekali per 2 menit). Ganti periode → cukup baca ulang dari database.
  useEffect(() => { void sync(false); }, [sync]);
  useEffect(() => { void load(); }, [load, range.from, range.to]);

  const merged = mergeAppData(summaryRows, infoList, netFilter);
  const sorted = sortRows(merged, sort);
  const nets = (r: { net: string }) => netFilter === 'semua' || r.net === netFilter;
  const deviceTotal = hours.filter(nets).reduce((a, r) => a + r.rx + r.tx, 0);
  const tetherTotal = tether.filter(nets).reduce((a, r) => a + r.rx + r.tx, 0);

  return { rows: sorted, deviceTotal, tetherTotal, loading, syncing, syncInfo, reload };
}

/** Selisih yang tidak bisa diatribusikan ke aplikasi mana pun: total sistem − jumlah semua aplikasi − hotspot. */
export function unattributed(deviceTotal: number, appsTotal: number, tetherTotal: number): number {
  return Math.max(0, deviceTotal - appsTotal - tetherTotal);
}

// ─── hook detail satu aplikasi ────────────────────────────────────────────────

/** Deret jam 35 hari terakhir (grafik detail tidak bergantung pada filter periode di daftar). */
export function useAppDetail(uid: number, now: number) {
  const [hours, setHours] = useState<AppHourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const from = startOfLocalDay(now) - 35 * DAY;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Quota.getAppHours({ uid, from, to: now + HOUR })
      .then((r) => { if (alive) setHours(r.rows); })
      .catch(() => { if (alive) setHours([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [uid, from, now]);

  return { hours, loading };
}

/** Rasio foreground/background pada rentang periode (Android 9+). null = tidak didukung/tidak terbaca. */
export function useForeground(uid: number, from: number, to: number) {
  const [res, setRes] = useState<{ fg: number; bg: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setRes(null);
    Quota.getAppForeground({ uid, from, to })
      .then((r) => { if (alive) setRes(r.supported ? { fg: r.fg, bg: r.bg } : null); })
      .catch(() => { if (alive) setRes(null); });
    return () => { alive = false; };
  }, [uid, from, to]);
  return res;
}

// ─── utiliti ─────────────────────────────────────────────────────────────────
export { fmtBytes };
