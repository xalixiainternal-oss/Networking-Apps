import { describe, expect, it } from 'vitest';
import { dailyAllowance, daysUntilQuotaEmpty, isWithinDailyWindow, sanitizeUssd, ussdHref, weekCompare } from './insights';
import { buildNativeConfig } from './nativeConfig';
import { describeRule } from './blocking';
import { mergeSettings, DEFAULTS } from './settings';
import { DAY, HOUR, addLocalDays, startOfLocalDay, type HourRow } from './usage';

const now = new Date(2026, 9, 12, 15, 30).getTime(); // 12 Okt 2026 15:30 lokal
const t0 = startOfLocalDay(now);
const hour = (dayOffset: number, bytes: number, net: 'cell' | 'wifi' = 'cell'): HourRow =>
  ({ t: addLocalDays(t0, dayOffset) + 10 * HOUR, net, rx: bytes, tx: 0 });

describe('jatah aman per hari', () => {
  it('membagi sisa dengan sisa hari (hari ini dihitung)', () => {
    const end = addLocalDays(t0, 10); // 10 hari lagi dari awal hari ini
    expect(dailyAllowance(10_000, now, end)).toBeCloseTo(1000, 5);
  });
  it('kuota habis → 0', () => {
    expect(dailyAllowance(0, now, t0 + 5 * DAY)).toBe(0);
    expect(dailyAllowance(-5, now, t0 + 5 * DAY)).toBe(0);
  });
  it('siklus sudah lewat/hampir selesai → tidak membagi dengan nol', () => {
    expect(dailyAllowance(500, now, now - 1)).toBe(500);
    expect(Number.isFinite(dailyAllowance(500, now, now))).toBe(true);
  });
});

describe('prediksi hari sampai kuota habis', () => {
  it('menggunakan rata-rata pemakaian siklus berjalan', () => {
    const start = now - 4 * DAY;
    expect(daysUntilQuotaEmpty(400, 1000, start, now)).toBeCloseTo(6, 5);
  });
  it('mengembalikan nol saat kuota habis dan null untuk kondisi tanpa laju', () => {
    expect(daysUntilQuotaEmpty(100, 100, t0, now)).toBe(0);
    expect(daysUntilQuotaEmpty(0, 100, t0, now)).toBeNull();
    expect(daysUntilQuotaEmpty(50, 0, t0, now)).toBeNull();
    expect(daysUntilQuotaEmpty(50, 100, now + DAY, now)).toBeNull();
  });
});

describe('jadwal blokir harian lokal', () => {
  it('memakai rentang awal inklusif dan akhir eksklusif serta melintasi tengah malam', () => {
    const dateAt = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute).getTime();
    expect(isWithinDailyWindow('08:00', '15:00', dateAt(8))).toBe(true);
    expect(isWithinDailyWindow('08:00', '15:00', dateAt(14, 59))).toBe(true);
    expect(isWithinDailyWindow('08:00', '15:00', dateAt(15))).toBe(false);
    expect(isWithinDailyWindow('22:00', '06:00', dateAt(23))).toBe(true);
    expect(isWithinDailyWindow('22:00', '06:00', dateAt(5, 59))).toBe(true);
    expect(isWithinDailyWindow('22:00', '06:00', dateAt(6))).toBe(false);
    expect(isWithinDailyWindow('08:00', '08:00', dateAt(8))).toBe(false);
  });
});

describe('perbandingan minggu', () => {
  it('menghitung persen kenaikan dan penurunan, hanya seluler', () => {
    const rows = [hour(0, 3000), hour(-6, 3000), hour(-7, 2000), hour(-13, 2000), hour(-3, 999_999, 'wifi')];
    const w = weekCompare(rows, now);
    expect(w.cur).toBe(6000); expect(w.prev).toBe(4000);
    expect(w.pct).toBeCloseTo(50, 5);
    expect(weekCompare([hour(0, 1000), hour(-8, 4000)], now).pct).toBeCloseTo(-75, 5);
  });
  it('minggu lalu kosong → pct null; data lebih tua dari 14 hari diabaikan', () => {
    expect(weekCompare([hour(0, 100), hour(-14, 5000)], now)).toEqual({ cur: 100, prev: 0, pct: null });
    expect(weekCompare([], now)).toEqual({ cur: 0, prev: 0, pct: null });
  });
});

describe('USSD', () => {
  it('membersihkan karakter selain angka, * dan #', () => {
    expect(sanitizeUssd(' *123# ')).toBe('*123#');
    expect(sanitizeUssd('*1a2b3#;rm')).toBe('*123#');
    expect(sanitizeUssd(undefined)).toBe('');
    expect(sanitizeUssd('1'.repeat(50)).length).toBe(24);
  });
  it('tautan tel: meng-encode # dan menolak kode tak valid', () => {
    expect(ussdHref('*123#')).toBe('tel:*123%23');
    expect(ussdHref('*888*1#')).toBe('tel:*888*1%23');
    expect(ussdHref('123')).toBeNull();
    expect(ussdHref('*123')).toBeNull();
    expect(ussdHref('')).toBeNull();
  });
  it('pengaturan lama tanpa ussd → kosong; data rusak dibersihkan', () => {
    expect(DEFAULTS.ussd).toBe('');
    expect(mergeSettings({ quotaValue: 5 }).ussd).toBe('');
    expect(mergeSettings({ ussd: '*123#<script>' }).ussd).toBe('*123#');
    expect(mergeSettings({ ussd: 42 }).ussd).toBe('');
  });
});

describe('blokir saat hotspot menyala', () => {
  it('aturan hanya-hot dipertahankan, hot harus true eksplisit, dan masuk ke konfigurasi native', () => {
    const s = mergeSettings({ blockOn: true, blockRules: {
      'com.h': { label: 'H', hot: true },
      'com.x': { label: 'X', hot: 'ya' },
    } });
    expect(Object.keys(s.blockRules)).toEqual(['com.h']);
    expect(s.blockRules['com.h']).toEqual({ label: 'H', cell: false, wifi: false, bg: false, autoBlock: false, hot: true });
    expect(buildNativeConfig(s).block.rules).toEqual([{ pkg: 'com.h', label: 'H', cell: false, wifi: false, bg: false, autoBlock: false, hot: true }]);
  });

  describe('backend Shizuku dan aksi keselamatan', () => {
    it('backend dan semua tindakan berisiko mati secara default', () => {
      expect(DEFAULTS.blockerMode).toBe('auto');
      expect(DEFAULTS.safety).toEqual({
        disableMobileData: false,
        stopHotspot: false,
        stopLimitedApps: false,
      });
    });

    it('membersihkan backend tak valid dan mempertahankan opt-in valid ke konfigurasi native', () => {
      expect(mergeSettings({ blockerMode: 'shell', safety: { stopHotspot: true, stopLimitedApps: 'yes' } }))
        .toMatchObject({ blockerMode: 'auto', safety: { disableMobileData: false, stopHotspot: true, stopLimitedApps: false } });
      const config = buildNativeConfig(mergeSettings({
        blockerMode: 'shizuku',
        safety: { disableMobileData: true, stopHotspot: false, stopLimitedApps: true },
      }));
      expect(config.blockerMode).toBe('shizuku');
      expect(config.safety).toEqual({ disableMobileData: true, stopHotspot: false, stopLimitedApps: true });
    });
  });

  describe('jadwal blokir', () => {
    it('mempertahankan nilai bawaan dan membersihkan waktu tidak valid', () => {
      expect(DEFAULTS.blockSchedule).toEqual({ enabled: false, start: '08:00', end: '15:00' });
      expect(mergeSettings({ blockSchedule: { enabled: true, start: '25:70', end: '06:30' } }).blockSchedule)
        .toEqual({ enabled: true, start: '08:00', end: '06:30' });
    });
    it('mengirim jadwal ke konfigurasi Kotlin', () => {
      const s = mergeSettings({ blockOn: true, blockSchedule: { enabled: true, start: '08:00', end: '15:00' } });
      expect(buildNativeConfig(s).blockSchedule).toEqual({ enabled: true, start: '08:00', end: '15:00' });
    });
  });
  it('aturan lama tanpa field hot → hot false', () => {
    expect(mergeSettings({ blockRules: { 'com.a': { label: 'A', cell: true } } }).blockRules['com.a'].hot).toBe(false);
  });
  it('describeRule menyebut hotspot', () => {
    expect(describeRule({ cell: false, wifi: false, bg: false, autoBlock: false, hot: true })).toBe('Saat hotspot menyala');
  });
});
