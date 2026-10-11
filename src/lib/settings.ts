import { useSyncExternalStore } from 'react';

export type Unit = 'MB' | 'GB';
export interface Amount { v: number; u: Unit }
export interface AppLimitCfg { label: string; daily: Amount; monthly: Amount }

/** Aturan blokir internet satu aplikasi (VPN lokal). */
export interface BlockRuleCfg { label: string; cell: boolean; wifi: boolean; bg: boolean; autoBlock: boolean }

export interface Settings {
  quotaValue: number; quotaUnit: Unit; resetDay: number; base: 1000 | 1024; theme: 'system' | 'light' | 'dark';
  /** Kuota Wi-Fi terpisah (0 = tidak dipakai). */
  wifiQuota: Amount;
  /** Kuota malam: pemakaian seluler di jam malam dihitung dulu ke sini. */
  night: { on: boolean; startHour: number; endHour: number; quota: Amount };
  /** Batas hotspot (0 = tanpa batas). */
  hotspot: { daily: Amount; monthly: Amount };
  /** Batas per aplikasi, kunci = nama paket. Dihitung dari data seluler. */
  appLimits: Record<string, AppLimitCfg>;
  /** Notifikasi peringatan 80/90/100%. */
  alerts: boolean;
  /** Notifikasi tetap (layanan latar). */
  persistent: boolean;
  /** Saklar utama pemblokiran (memakai slot VPN). Mati = tidak ada yang diblokir, aturan tetap tersimpan. */
  blockOn: boolean;
  /** Aturan blokir per aplikasi, kunci = nama paket. */
  blockRules: Record<string, BlockRuleCfg>;
}

const KEY = 'settings.v1';
const A0 = (): Amount => ({ v: 0, u: 'GB' });
export const DEFAULTS: Settings = {
  quotaValue: 0, quotaUnit: 'GB', resetDay: 1, base: 1000, theme: 'system',
  wifiQuota: A0(),
  night: { on: false, startHour: 0, endHour: 5, quota: A0() },
  hotspot: { daily: A0(), monthly: A0() },
  appLimits: {},
  alerts: true, persistent: true,
  blockOn: false, blockRules: {},
};

const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const amount = (x: unknown): Amount => {
  const o = (x ?? {}) as Partial<Amount>;
  return { v: Math.max(0, num(o.v, 0)), u: o.u === 'MB' ? 'MB' : 'GB' };
};
const hour = (x: unknown, d: number) => Math.min(23, Math.max(0, Math.floor(num(x, d))));

/** Gabungkan data tersimpan (bisa dari versi lama atau rusak) dengan bawaan, lapis demi lapis. */
export function mergeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const limits: Record<string, AppLimitCfg> = {};
  if (r.appLimits && typeof r.appLimits === 'object') {
    for (const [pkg, l] of Object.entries<any>(r.appLimits)) {
      if (!pkg || !l || typeof l !== 'object') continue;
      limits[pkg] = { label: typeof l.label === 'string' ? l.label : pkg, daily: amount(l.daily), monthly: amount(l.monthly) };
    }
  }
  const rules: Record<string, BlockRuleCfg> = {};
  if (r.blockRules && typeof r.blockRules === 'object') {
    for (const [pkg, b] of Object.entries<any>(r.blockRules)) {
      if (!pkg || !b || typeof b !== 'object') continue;
      const rule = { label: typeof b.label === 'string' ? b.label : pkg, cell: b.cell === true, wifi: b.wifi === true, bg: b.bg === true, autoBlock: b.autoBlock === true };
      if (rule.cell || rule.wifi || rule.bg || rule.autoBlock) rules[pkg] = rule;
    }
  }
  return {
    quotaValue: Math.max(0, num(r.quotaValue, DEFAULTS.quotaValue)),
    quotaUnit: r.quotaUnit === 'MB' ? 'MB' : 'GB',
    resetDay: Math.min(31, Math.max(1, Math.floor(num(r.resetDay, 1)))),
    base: r.base === 1024 ? 1024 : 1000,
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    wifiQuota: amount(r.wifiQuota),
    night: {
      on: r.night?.on === true,
      startHour: hour(r.night?.startHour, 0), endHour: hour(r.night?.endHour, 5),
      quota: amount(r.night?.quota),
    },
    hotspot: { daily: amount(r.hotspot?.daily), monthly: amount(r.hotspot?.monthly) },
    appLimits: limits,
    alerts: r.alerts !== false,
    persistent: r.persistent !== false,
    blockOn: r.blockOn === true,
    blockRules: rules,
  };
}

let cache: Settings = (() => { try { return mergeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return mergeSettings({}); } })();
const subs = new Set<() => void>();

export const amountBytes = (a: Amount, base: 1000 | 1024) => Math.round(a.v * Math.pow(base, a.u === 'GB' ? 3 : 2));
export const quotaBytes = (s: Settings) => Math.round(s.quotaValue * Math.pow(s.base, s.quotaUnit === 'GB' ? 3 : 2));

export function updateSettings(patch: Partial<Settings>) {
  cache = { ...cache, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* penyimpanan penuh: abaikan */ }
  subs.forEach((f) => f());
}

/** Atur batas satu aplikasi; bila harian dan bulanan sama-sama 0, batasnya dihapus. */
export function setAppLimit(pkg: string, label: string, daily: Amount, monthly: Amount) {
  const next = { ...cache.appLimits };
  if (daily.v <= 0 && monthly.v <= 0) delete next[pkg];
  else next[pkg] = { label, daily, monthly };
  updateSettings({ appLimits: next });
}

/** Ubah sebagian aturan blokir satu aplikasi; aturan yang semua pilihannya mati dihapus. */
export function setBlockRule(pkg: string, label: string, patch: Partial<Omit<BlockRuleCfg, 'label'>>) {
  const prev = cache.blockRules[pkg] ?? { label, cell: false, wifi: false, bg: false, autoBlock: false };
  const next: BlockRuleCfg = { ...prev, ...patch, label };
  const rules = { ...cache.blockRules };
  if (next.cell || next.wifi || next.bg || next.autoBlock) rules[pkg] = next; else delete rules[pkg];
  updateSettings({ blockRules: rules });
}

export const useSettings = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cache);

export function applyTheme(t: Settings['theme']) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
