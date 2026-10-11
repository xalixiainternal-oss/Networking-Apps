import { describe, expect, it } from 'vitest';
import { mergeSettings } from './settings';
import { buildNativeConfig } from './nativeConfig';
import { describeRule, describeVpn, hasAnyLimit } from './blocking';
import type { VpnState } from './quotaPlugin';

const vpn = (o: Partial<VpnState> = {}): VpnState => ({ prepared: true, running: true, blocked: 0, dropped: 0, otherVpn: false, revokedAt: 0, autoBlocked: [], ...o });

describe('aturan blokir di pengaturan', () => {
  it('data lama tanpa blokir: mati dan kosong', () => {
    const s = mergeSettings({ quotaValue: 5 });
    expect(s.blockOn).toBe(false); expect(s.blockRules).toEqual({});
  });
  it('aturan yang semua pilihannya mati dibuang; selain itu dipertahankan', () => {
    const s = mergeSettings({ blockOn: true, blockRules: {
      'com.a': { label: 'A', cell: true },
      'com.b': { label: 'B', cell: false, wifi: false, bg: false, autoBlock: false },
      'com.c': 'rusak', '': { cell: true },
    } });
    expect(s.blockOn).toBe(true);
    expect(Object.keys(s.blockRules)).toEqual(['com.a']);
    expect(s.blockRules['com.a']).toEqual({ label: 'A', cell: true, wifi: false, bg: false, autoBlock: false });
  });
  it('hanya true eksplisit yang menyalakan saklar utama', () => {
    expect(mergeSettings({ blockOn: 'ya' }).blockOn).toBe(false);
    expect(mergeSettings({ blockOn: 1 }).blockOn).toBe(false);
  });
  it('konfigurasi native memuat saklar dan aturan', () => {
    const s = mergeSettings({ blockOn: true, blockRules: { 'com.a': { label: 'A', cell: true, bg: true } } });
    expect(buildNativeConfig(s).block).toEqual({ on: true, rules: [{ pkg: 'com.a', label: 'A', cell: true, wifi: false, bg: true, autoBlock: false }] });
  });
});

describe('ringkasan', () => {
  it('describeRule', () => {
    expect(describeRule({ cell: true, wifi: false, bg: true, autoBlock: false })).toBe('Seluler · Background');
    expect(describeRule({ cell: false, wifi: true, bg: false, autoBlock: true })).toBe('Wi-Fi · Otomatis saat batas');
  });
  it('describeVpn menjelaskan tiap keadaan dengan jujur', () => {
    expect(describeVpn(false, null).tone).toBe('mati');
    expect(describeVpn(true, null).tone).toBe('perhatian');
    expect(describeVpn(true, vpn({ prepared: false })).text).toContain('Izin VPN belum');
    expect(describeVpn(true, vpn({ running: false, otherVpn: true })).text).toContain('VPN lain');
    expect(describeVpn(true, vpn({ running: false, revokedAt: 5 })).text).toContain('berhenti');
    expect(describeVpn(true, vpn({ running: false })).text).toContain('belum berjalan');
    expect(describeVpn(true, vpn({ blocked: 3 })).text).toContain('3 aplikasi');
    expect(describeVpn(true, vpn()).tone).toBe('ok');
  });
  it('hasAnyLimit', () => {
    const s = mergeSettings({ appLimits: { 'com.a': { label: 'A', daily: { v: 1, u: 'GB' } }, 'com.b': { label: 'B' } } });
    expect(hasAnyLimit(s, 'com.a')).toBe(true);
    expect(hasAnyLimit(s, 'com.b')).toBe(false);
    expect(hasAnyLimit(s, 'com.z')).toBe(false);
  });
});
