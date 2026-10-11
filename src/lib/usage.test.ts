import { describe, expect, it } from 'vitest';
import { HOUR, bucketSeries, cycleRange, fmtBytes, forecast, percent, splitByNet, startOfLocalDay, type HourRow } from './usage';

const L = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime(); // waktu lokal

describe('cycleRange', () => {
  it('setelah tanggal reset: siklus mulai bulan ini', () => {
    const r = cycleRange(L(2026, 10, 20), 15);
    expect(r.start).toBe(L(2026, 10, 15)); expect(r.end).toBe(L(2026, 11, 15));
  });
  it('sebelum tanggal reset: siklus mulai bulan lalu', () => {
    const r = cycleRange(L(2026, 10, 10), 15);
    expect(r.start).toBe(L(2026, 9, 15)); expect(r.end).toBe(L(2026, 10, 15));
  });
  it('tepat saat reset masuk siklus baru (batas bawah inklusif)', () => {
    expect(cycleRange(L(2026, 10, 15), 15).start).toBe(L(2026, 10, 15));
  });
  it('reset 31: sehari sebelum akhir Februari masih siklus Januari', () => {
    const r = cycleRange(L(2026, 2, 27, 12), 31);
    expect(r.start).toBe(L(2026, 1, 31)); expect(r.end).toBe(L(2026, 2, 28));
  });
  it('reset 31: tanggal 28 Februari adalah hari reset (dipotong ke akhir bulan)', () => {
    const r = cycleRange(L(2026, 2, 28, 12), 31);
    expect(r.start).toBe(L(2026, 2, 28)); expect(r.end).toBe(L(2026, 3, 31));
  });
  it('lintas tahun', () => {
    const r = cycleRange(L(2026, 1, 5), 20);
    expect(r.start).toBe(L(2025, 12, 20)); expect(r.end).toBe(L(2026, 1, 20));
  });
  it('akhir Desember menuju Januari', () => {
    const r = cycleRange(L(2026, 12, 25), 20);
    expect(r.start).toBe(L(2026, 12, 20)); expect(r.end).toBe(L(2027, 1, 20));
  });
});

describe('bucket & penjumlahan', () => {
  const day = startOfLocalDay(L(2026, 10, 10, 5));
  const rows: HourRow[] = [
    { t: day + 1 * HOUR, net: 'cell', rx: 100, tx: 10 },
    { t: day + 1 * HOUR, net: 'wifi', rx: 500, tx: 50 },
    { t: day + 23 * HOUR, net: 'cell', rx: 7, tx: 3 },
  ];
  it('24 bucket jam, nol bila kosong, total sama dengan jumlah baris', () => {
    const b = bucketSeries(rows, day, 24, 'hour');
    expect(b).toHaveLength(24);
    expect(b[1]).toMatchObject({ cell: 110, wifi: 550 });
    expect(b[0]).toMatchObject({ cell: 0, wifi: 0 });
    expect(b.reduce((a, x) => a + x.cell + x.wifi, 0)).toBe(670);
  });
  it('bucket harian menggabungkan jam dalam hari lokal yang sama', () => {
    const b = bucketSeries(rows, day, 2, 'day');
    expect(b[0].cell).toBe(120); expect(b[0].wifi).toBe(550); expect(b[1].cell + b[1].wifi).toBe(0);
  });
  it('batas atas eksklusif', () => {
    expect(splitByNet(rows, day, day + 1 * HOUR).cell.rx).toBe(0);
    expect(splitByNet(rows, day, day + 2 * HOUR).cell.rx).toBe(100);
  });
});

describe('persentase & perkiraan', () => {
  it('percent', () => { expect(percent(50, 200)).toBe(25); expect(percent(5, 0)).toBe(0); expect(percent(250, 200)).toBe(125); });
  const s = L(2026, 10, 1), e = L(2026, 11, 1);
  it('habis', () => expect(forecast(100, 100, s, e, L(2026, 10, 10)).kind).toBe('habis'));
  it('tanpa kuota', () => expect(forecast(1, 0, s, e, L(2026, 10, 10)).kind).toBe('tanpa'));
  it('belum ada pemakaian', () => expect(forecast(0, 100, s, e, L(2026, 10, 10)).kind).toBe('belum'));
  it('aman bila laju tidak menghabiskan sebelum siklus berakhir', () =>
    expect(forecast(10, 1000, s, e, L(2026, 10, 10)).kind).toBe('aman'));
  it('tanggal habis dari rata-rata harian', () => {
    const now = L(2026, 10, 11); // 10 hari, terpakai 500 dari 1000 → habis 10 hari lagi
    const f = forecast(500, 1000, s, e, now);
    expect(f.kind).toBe('tanggal');
    if (f.kind === 'tanggal') expect(Math.round((f.at - now) / 86_400_000)).toBe(10);
  });
});

describe('format byte', () => {
  it('desimal vs biner', () => {
    expect(fmtBytes(1_000_000, 1000)).toContain('MB');
    expect(fmtBytes(1_048_576, 1024)).toBe('1 MiB');
    expect(fmtBytes(999, 1000)).toBe('999 B');
  });
});

// ─── Test logika per-aplikasi (v0.3) ────────────────────────────────────────
import { mergeAppData, sortRows, appBucketSeries, periodRange, type AppSummaryItem, type AppInfoItem, type AppHourRow } from './appUsage';

const sum: AppSummaryItem[] = [
  { uid: 1001, rx: 1000, tx: 100, rxCell: 800, txCell: 80, rxWifi: 200, txWifi: 20 },
  { uid: 1002, rx: 500,  tx: 50,  rxCell: 0,   txCell: 0,  rxWifi: 500, txWifi: 50 },
  { uid: 9999, rx: 10,   tx: 1,   rxCell: 10,  txCell: 1,  rxWifi: 0,   txWifi: 0  },
];
const info: AppInfoItem[] = [
  { uid: 1001, packageName: 'com.app.a', label: 'Aplikasi A', isSystem: 0 },
  { uid: 1002, packageName: 'com.app.b', label: 'Aplikasi B', isSystem: 0 },
  // uid 9999 tidak dikenal (sistem tanpa nama)
];

describe('mergeAppData', () => {
  it('menggabungkan summary + info, menghitung total dan persentase', () => {
    const rows = mergeAppData(sum, info, 'semua');
    const a = rows.find(r => r.uid === 1001)!;
    expect(a.label).toBe('Aplikasi A');
    expect(a.total).toBe(1100);
    expect(a.pct).toBeCloseTo(1100 / (1100 + 550 + 11) * 100, 1);
  });
  it('filter cell: hanya rxCell + txCell', () => {
    const rows = mergeAppData(sum, info, 'cell');
    const a = rows.find(r => r.uid === 1001)!;
    expect(a.rx).toBe(800); expect(a.tx).toBe(80); expect(a.total).toBe(880);
    const b = rows.find(r => r.uid === 1002)!;
    expect(b.total).toBe(0);
  });
  it('filter wifi: hanya rxWifi + txWifi', () => {
    const rows = mergeAppData(sum, info, 'wifi');
    const b = rows.find(r => r.uid === 1002)!;
    expect(b.total).toBe(550);
  });
  it('uid tanpa info menggunakan label fallback', () => {
    const rows = mergeAppData(sum, info, 'semua');
    const u = rows.find(r => r.uid === 9999)!;
    expect(u.label).toMatch(/UID 9999/);
  });
});

describe('sortRows', () => {
  const rows = mergeAppData(sum, info, 'semua');
  it('urut total: terbesar duluan', () => {
    const s = sortRows(rows, 'total');
    expect(s[0].total).toBeGreaterThanOrEqual(s[1].total);
  });
  it('urut label: A-Z', () => {
    const s = sortRows(rows, 'label');
    expect(s[0].label.localeCompare(s[1].label, 'id')).toBeLessThanOrEqual(0);
  });
});

describe('appBucketSeries', () => {
  const now = new Date(2026, 9, 10, 5, 0, 0).getTime(); // 10 Okt 2026 jam 05:00
  const t0  = new Date(2026, 9, 10, 0, 0, 0).getTime();
  const HOUR = 3_600_000;
  const hrs: AppHourRow[] = [
    { uid: 1, t: t0 + 2 * HOUR, net: 'cell', rx: 200, tx: 20, isFg: 0 },
    { uid: 1, t: t0 + 2 * HOUR, net: 'wifi', rx: 100, tx: 10, isFg: 0 },
    { uid: 1, t: t0 + 4 * HOUR, net: 'cell', rx: 50,  tx: 5,  isFg: 0 },
  ];
  it('24 bucket jam, nilai tepat di slot yang benar', () => {
    const b = appBucketSeries(hrs, t0, 24, 'hour');
    expect(b).toHaveLength(24);
    expect(b[2]).toMatchObject({ cell: 220, wifi: 110 });
    expect(b[4]).toMatchObject({ cell: 55, wifi: 0 });
    expect(b[0]).toMatchObject({ cell: 0, wifi: 0 });
  });
});

describe('periodRange', () => {
  const now = new Date(2026, 9, 10, 12).getTime();
  it('hari-ini: from = awal hari lokal', () => {
    const r = periodRange('hari-ini', 1, now);
    expect(r.from).toBe(new Date(2026, 9, 10, 0, 0, 0).getTime());
  });
  it('siklus: gunakan resetDay', () => {
    const r = periodRange('siklus', 5, now);
    expect(r.from).toBe(new Date(2026, 9, 5, 0, 0, 0).getTime());
  });
});
