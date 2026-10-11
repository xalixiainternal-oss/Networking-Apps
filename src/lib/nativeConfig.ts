import { useSyncExternalStore } from 'react';
import { Quota } from './quotaPlugin';
import { amountBytes, quotaBytes, type Settings } from './settings';

/** Bentuk JSON yang dibaca sisi Kotlin (QuotaConfig.parse). Semua angka dalam byte. */
export function buildNativeConfig(s: Settings) {
  return {
    base: s.base,
    resetDay: s.resetDay,
    cellQuota: quotaBytes(s),
    wifiQuota: amountBytes(s.wifiQuota, s.base),
    night: { on: s.night.on, startHour: s.night.startHour, endHour: s.night.endHour, quota: amountBytes(s.night.quota, s.base) },
    hotspot: { daily: amountBytes(s.hotspot.daily, s.base), monthly: amountBytes(s.hotspot.monthly, s.base) },
    appLimits: Object.entries(s.appLimits)
      .map(([pkg, l]) => ({ pkg, label: l.label, daily: amountBytes(l.daily, s.base), monthly: amountBytes(l.monthly, s.base) }))
      .filter((l) => l.daily > 0 || l.monthly > 0),
    alerts: s.alerts,
    persistent: s.persistent,
    block: {
      on: s.blockOn,
      rules: Object.entries(s.blockRules).map(([pkg, r]) => ({ pkg, label: r.label, cell: r.cell, wifi: r.wifi, bg: r.bg, autoBlock: r.autoBlock })),
    },
  };
}

// Penanda "konfigurasi native sudah diperbarui": hook status membaca ulang setiap kali naik.
let version = 0;
const subs = new Set<() => void>();
export const useConfigVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);

export async function pushConfig(s: Settings): Promise<void> {
  try {
    await Quota.setConfig({ json: JSON.stringify(buildNativeConfig(s)) });
  } catch { /* di browser / gagal: UI tetap jalan dari data yang ada */ }
  version++;
  subs.forEach((f) => f());
}
