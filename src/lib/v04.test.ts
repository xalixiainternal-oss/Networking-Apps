import { describe, expect, it } from 'vitest';
import { HOUR, addLocalDays, startOfLocalDay } from './usage';
import { mergeSettings, amountBytes, quotaBytes, DEFAULTS } from './settings';
import { buildNativeConfig } from './nativeConfig';
import { sumTether, tetherSeries, type TetherRow } from './hotspot';
import { periodRange, unattributed } from './appUsage';

describe('mergeSettings', () => {
  it('data lama (v0.3) tetap terbaca dan field baru terisi bawaan', () => {
    const s = mergeSettings({ quotaValue: 5, quotaUnit: 'GB', resetDay: 17, base: 1024, theme: 'dark' });
    expect(s.quotaValue).toBe(5); expect(s.resetDay).toBe(17); expect(s.base).toBe(1024); expect(s.theme).toBe('dark');
    expect(s.night).toEqual(DEFAULTS.night); expect(s.alerts).toBe(true); expect(s.persistent).toBe(true);
  });
  it('data rusak jatuh ke bawaan, angka dipagari', () => {
    const s = mergeSettings({ quotaValue: -3, resetDay: 99, base: 7, night: { startHour: 40, endHour: -2 }, appLimits: { a: 5, b: { daily: { v: 2, u: 'MB' } } } });
    expect(s.quotaValue).toBe(0); expect(s.resetDay).toBe(31); expect(s.base).toBe(1000);
    expect(s.night.startHour).toBe(23); expect(s.night.endHour).toBe(0);
    expect(Object.keys(s.appLimits)).toEqual(['b']); expect(s.appLimits.b.daily).toEqual({ v: 2, u: 'MB' });
    expect(mergeSettings(null)).toEqual(mergeSettings({}));
  });
  it('flag boolean: hanya false eksplisit yang mematikan', () => {
    expect(mergeSettings({ alerts: false }).alerts).toBe(false);
    expect(mergeSettings({ alerts: 'x' }).alerts).toBe(true);
  });
});

describe('byte & konfigurasi native', () => {
  it('amountBytes desimal vs biner dan pembulatan', () => {
    expect(amountBytes({ v: 1.5, u: 'GB' }, 1000)).toBe(1_500_000_000);
    expect(amountBytes({ v: 1, u: 'MB' }, 1024)).toBe(1_048_576);
    expect(Number.isInteger(amountBytes({ v: 0.1, u: 'GB' }, 1000))).toBe(true);
  });
  it('buildNativeConfig: semua dalam byte, batas kosong dibuang', () => {
    const s = mergeSettings({
      quotaValue: 5, quotaUnit: 'GB', wifiQuota: { v: 100, u: 'GB' },
      night: { on: true, startHour: 22, endHour: 6, quota: { v: 2, u: 'GB' } },
      hotspot: { daily: { v: 500, u: 'MB' }, monthly: { v: 0, u: 'GB' } },
      appLimits: { 'com.a': { label: 'A', daily: { v: 1, u: 'GB' }, monthly: { v: 0, u: 'GB' } }, 'com.b': { label: 'B', daily: { v: 0, u: 'GB' }, monthly: { v: 0, u: 'GB' } } },
    });
    const c = buildNativeConfig(s);
    expect(c.cellQuota).toBe(quotaBytes(s)); expect(c.cellQuota).toBe(5_000_000_000);
    expect(c.wifiQuota).toBe(100_000_000_000);
    expect(c.night).toEqual({ on: true, startHour: 22, endHour: 6, quota: 2_000_000_000 });
    expect(c.hotspot).toEqual({ daily: 500_000_000, monthly: 0 });
    expect(c.appLimits).toEqual([{ pkg: 'com.a', label: 'A', daily: 1_000_000_000, monthly: 0 }]);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe('hotspot', () => {
  const day = startOfLocalDay(new Date(2026, 9, 10, 5).getTime());
  const rows: TetherRow[] = [
    { t: day + 1 * HOUR, net: 'cell', rx: 100, tx: 10 },
    { t: day + 1 * HOUR, net: 'wifi', rx: 5, tx: 1 },
    { t: day + 23 * HOUR, net: 'cell', rx: 7, tx: 3 },
  ];
  it('jumlah rentang, batas atas eksklusif', () => {
    expect(sumTether(rows, day, day + 2 * HOUR)).toEqual({ rx: 105, tx: 11 });
    expect(sumTether(rows, day, day + 1 * HOUR)).toEqual({ rx: 0, tx: 0 });
  });
  it('24 bucket jam; total bucket = total baris', () => {
    const b = tetherSeries(rows, day, 24, 'hour');
    expect(b).toHaveLength(24); expect(b[1].total).toBe(116); expect(b[0].total).toBe(0);
    expect(b.reduce((a, x) => a + x.total, 0)).toBe(126);
  });
  it('bucket harian menggabungkan jam dalam hari lokal yang sama', () => {
    const b = tetherSeries(rows, addLocalDays(day, -1), 2, 'day');
    expect(b[0].total).toBe(0); expect(b[1].total).toBe(126);
  });
});

describe('selisih sistem & rentang kustom', () => {
  it('unattributed tidak pernah negatif', () => {
    expect(unattributed(1000, 700, 100)).toBe(200);
    expect(unattributed(1000, 950, 100)).toBe(0);
  });
  it('kustom: batas atas = awal hari berikutnya dari hari terakhir yang dipilih', () => {
    const from = new Date(2026, 9, 1).getTime(), to = new Date(2026, 9, 3).getTime();
    const r = periodRange('kustom', 1, new Date(2026, 9, 10, 12).getTime(), from, to);
    expect(r.from).toBe(from); expect(r.to).toBe(new Date(2026, 9, 4).getTime());
  });
});
