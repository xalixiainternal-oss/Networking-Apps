import { DAY, HOUR, addLocalDays, startOfLocalDay, sumRows, type HourRow } from './usage';

/** Jatah aman per hari: sisa kuota dibagi sisa hari siklus (hari ini dihitung). 0 bila kuota sudah habis. */
export function dailyAllowance(remaining: number, now: number, cycleEnd: number): number {
  if (remaining <= 0) return 0;
  const daysLeft = Math.max(1, Math.ceil((cycleEnd - now) / DAY));
  return remaining / daysLeft;
}

/** Estimasi hari hingga kuota habis dari rata-rata pemakaian siklus berjalan; null bila belum ada laju terukur. */
export function daysUntilQuotaEmpty(used: number, quota: number, periodStart: number, now: number): number | null {
  if (![used, quota, periodStart, now].every(Number.isFinite) || quota <= 0 || used < 0 || now < periodStart) return null;
  if (used >= quota) return 0;
  if (used === 0) return null;
  const elapsedDays = Math.max((now - periodStart) / DAY, 1);
  const averageDaily = used / elapsedDays;
  const days = (quota - used) / averageDaily;
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/** Pemeriksaan jadwal harian lokal yang sama dengan rentang native: awal inklusif, akhir eksklusif. */
export function isWithinDailyWindow(start: string, end: string, now: number): boolean {
  const parse = (time: string) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const from = parse(start), to = parse(end);
  if (from === null || to === null || from === to || !Number.isFinite(now)) return false;
  const date = new Date(now), minute = date.getHours() * 60 + date.getMinutes();
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export interface WeekCompare {
  /** Seluler 7 hari terakhir (termasuk hari ini). */
  cur: number;
  /** Seluler 7 hari sebelumnya. */
  prev: number;
  /** Perubahan dalam persen; null bila minggu lalu kosong (tidak bisa dibandingkan). */
  pct: number | null;
}

/** Bandingkan pemakaian seluler 7 hari terakhir dengan 7 hari sebelumnya (hari mengikuti zona waktu lokal). */
export function weekCompare(rows: HourRow[], now: number): WeekCompare {
  const t0 = startOfLocalDay(now);
  const curFrom = addLocalDays(t0, -6);
  const prevFrom = addLocalDays(t0, -13);
  const c = sumRows(rows, curFrom, now + HOUR, 'cell');
  const p = sumRows(rows, prevFrom, curFrom, 'cell');
  const cur = c.rx + c.tx, prev = p.rx + p.tx;
  return { cur, prev, pct: prev > 0 ? ((cur - prev) / prev) * 100 : null };
}

/** Hanya angka, * dan # yang boleh ada di kode USSD. */
export const sanitizeUssd = (raw: unknown): string =>
  (typeof raw === 'string' ? raw : '').replace(/[^0-9*#]/g, '').slice(0, 24);

/** Tautan tel: untuk kode USSD yang valid (diawali * atau #, diakhiri #), selain itu null. '#' di-encode agar tidak jadi fragmen URL. */
export function ussdHref(code: string): string | null {
  const c = sanitizeUssd(code);
  if (c.length < 3 || !/^[*#]/.test(c) || !c.endsWith('#')) return null;
  return `tel:${encodeURIComponent(c)}`;
}
