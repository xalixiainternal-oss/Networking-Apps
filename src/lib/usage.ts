export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export type Net = 'cell' | 'wifi';
export interface HourRow { t: number; net: Net; rx: number; tx: number }
export interface Bytes { rx: number; tx: number }

export const startOfLocalDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const addLocalDays = (ms: number, n: number) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate(); // m boleh -1 atau 12
const clampDay = (y: number, m: number, day: number) => Math.min(Math.max(1, Math.floor(day)), daysInMonth(y, m));

/** Siklus tagihan [start, end) berdasarkan tanggal reset. Tanggal 31 dipotong ke akhir bulan pendek. */
export function cycleRange(now: number, resetDay: number): { start: number; end: number } {
  const d = new Date(now), y = d.getFullYear(), m = d.getMonth();
  const thisReset = new Date(y, m, clampDay(y, m, resetDay)).getTime();
  if (now >= thisReset) {
    return { start: thisReset, end: new Date(y, m + 1, clampDay(y, m + 1, resetDay)).getTime() };
  }
  return { start: new Date(y, m - 1, clampDay(y, m - 1, resetDay)).getTime(), end: thisReset };
}

export function sumRows(rows: HourRow[], from: number, to: number, net?: Net): Bytes {
  let rx = 0, tx = 0;
  for (const r of rows) if (r.t >= from && r.t < to && (!net || r.net === net)) { rx += r.rx; tx += r.tx; }
  return { rx, tx };
}

export const splitByNet = (rows: HourRow[], from: number, to: number) =>
  ({ cell: sumRows(rows, from, to, 'cell'), wifi: sumRows(rows, from, to, 'wifi') });

export interface Bucket { t: number; cell: number; wifi: number }

/** Deret bucket berukuran tetap (nol bila kosong). Hari mengikuti zona waktu lokal. */
export function bucketSeries(rows: HourRow[], start: number, count: number, gran: 'hour' | 'day'): Bucket[] {
  const starts = Array.from({ length: count + 1 }, (_, i) => gran === 'hour' ? start + i * HOUR : addLocalDays(start, i));
  return starts.slice(0, count).map((t, i) => {
    const s = splitByNet(rows, t, starts[i + 1]);
    return { t, cell: s.cell.rx + s.cell.tx, wifi: s.wifi.rx + s.wifi.tx };
  });
}

export const percent = (used: number, quota: number) => (quota <= 0 ? 0 : (used / quota) * 100);

export type Forecast =
  | { kind: 'tanpa' } | { kind: 'belum' } | { kind: 'habis' } | { kind: 'aman' } | { kind: 'tanggal'; at: number };

export function forecast(used: number, quota: number, cycleStart: number, cycleEnd: number, now: number): Forecast {
  if (quota <= 0) return { kind: 'tanpa' };
  if (used >= quota) return { kind: 'habis' };
  const elapsed = now - cycleStart;
  if (used <= 0 || elapsed <= 0) return { kind: 'belum' };
  const at = now + (quota - used) / (used / elapsed);
  return at >= cycleEnd ? { kind: 'aman' } : { kind: 'tanggal', at };
}

export function fmtBytes(n: number, base: 1000 | 1024 = 1000): string {
  const u = base === 1000 ? ['B', 'KB', 'MB', 'GB', 'TB'] : ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0, v = Math.max(0, n);
  while (v >= base && i < u.length - 1) { v /= base; i++; }
  return `${v.toLocaleString('id-ID', { maximumFractionDigits: i === 0 ? 0 : 2 })} ${u[i]}`;
}

export const fmtSpeed = (bps: number, base: 1000 | 1024 = 1000) => `${fmtBytes(bps, base)}/s`;
