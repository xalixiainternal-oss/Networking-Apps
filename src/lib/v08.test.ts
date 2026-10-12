import { describe, expect, it } from 'vitest';
import { buildNativeConfig } from './nativeConfig';
import { DEFAULTS, mergeSettings } from './settings';

describe('batas harian seluler (v0.8)', () => {
  it('bawaan: tidak dipakai, langkah 200 MB, tanpa pemutusan', () => {
    expect(DEFAULTS.dailyLimit).toEqual({ quota: { v: 0, u: 'GB' }, step: { v: 200, u: 'MB' }, cutoff: { v: 0, u: 'GB' } });
    expect(mergeSettings({}).dailyLimit).toEqual(DEFAULTS.dailyLimit);
  });

  it('langkah kosong/rusak/negatif kembali ke 200 MB, angka lain dipertahankan', () => {
    expect(mergeSettings({ dailyLimit: { step: { v: 0, u: 'MB' } } }).dailyLimit.step).toEqual({ v: 200, u: 'MB' });
    expect(mergeSettings({ dailyLimit: { step: 'x' } }).dailyLimit.step).toEqual({ v: 200, u: 'MB' });
    expect(mergeSettings({ dailyLimit: { step: { v: -5, u: 'MB' } } }).dailyLimit.step).toEqual({ v: 200, u: 'MB' });
    expect(mergeSettings({ dailyLimit: { quota: { v: 1, u: 'GB' }, step: { v: 500, u: 'MB' }, cutoff: { v: 1, u: 'GB' } } }).dailyLimit)
      .toEqual({ quota: { v: 1, u: 'GB' }, step: { v: 500, u: 'MB' }, cutoff: { v: 1, u: 'GB' } });
  });

  it('dikirim ke native dalam byte sesuai basis satuan', () => {
    const s = mergeSettings({ base: 1000, dailyLimit: { quota: { v: 1, u: 'GB' }, step: { v: 200, u: 'MB' }, cutoff: { v: 400, u: 'MB' } } });
    expect(buildNativeConfig(s).dailyLimit).toEqual({ quota: 1_000_000_000, step: 200_000_000, cutoff: 400_000_000 });
    const b = mergeSettings({ base: 1024, dailyLimit: { quota: { v: 1, u: 'GB' } } });
    expect(buildNativeConfig(b).dailyLimit.quota).toBe(1024 ** 3);
  });
});
