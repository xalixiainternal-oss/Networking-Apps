import { registerPlugin, Capacitor } from '@capacitor/core';
import type { HourRow } from './usage';

export interface PermissionStatus {
  usageAccess: boolean;
  notifications: boolean;
  batteryOptimizationIgnored: boolean;
}

export interface SyncInfo { ok: boolean; rows: number; mobileSupported: boolean; sdk: number; message?: string | null }

export interface AppSummaryItem {
  uid: number;
  rx: number; tx: number;
  rxCell: number; txCell: number;
  rxWifi: number; txWifi: number;
}

export interface AppInfoItem {
  uid: number;
  packageName: string;
  label: string;
  isSystem: number;
}

export interface AppHourRow {
  uid: number; t: number; net: 'cell' | 'wifi'; rx: number; tx: number; isFg: number;
}

export interface LimitItem {
  id: string;
  kind: 'cell' | 'night' | 'wifi' | 'hotspot-day' | 'hotspot-cycle' | 'app-day' | 'app-cycle';
  title: string; used: number; quota: number; pct: number; level: 0 | 80 | 90 | 100;
  periodStart: number; periodEnd: number;
}
export interface QuotaStatus {
  items: LimitItem[]; cycleStart: number; cycleEnd: number; dayStart: number; todayCell: number; todayWifi: number;
}
export interface TetherRow { t: number; net: 'cell' | 'wifi'; rx: number; tx: number }
export interface HotspotState { active: boolean; kind: 'wifi' | 'usb' | 'bluetooth' | 'none'; iface: string }
export interface Capabilities {
  sdk: number; mobileStats: boolean; foregroundSplit: boolean; tetherSeen: boolean; notifications: boolean;
}

export interface VpnState {
  /** Izin VPN sudah diberikan ke app ini. */
  prepared: boolean;
  /** Layanan pemblokir sedang berjalan. */
  running: boolean;
  /** Jumlah aplikasi yang diblokir SAAT INI. */
  blocked: number;
  /** Paket yang dibuang sejak layanan mulai (bukti pemblokiran bekerja). */
  dropped: number;
  /** VPN lain sedang aktif di HP ini. */
  otherVpn: boolean;
  /** Kapan izin/slot VPN terakhir dicabut atau diambil VPN lain (0 = belum pernah). */
  revokedAt: number;
  autoBlocked: { pkg: string; until: number }[];
}

export interface QuotaPlugin {
  getPermissionStatus(): Promise<PermissionStatus>;
  openUsageAccessSettings(): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  openBatterySettings(): Promise<void>;
  startTracking(): Promise<void>;
  syncNow(): Promise<SyncInfo>;
  syncAppsNow(): Promise<SyncInfo>;
  getHours(o: { from: number; to: number }): Promise<{ rows: HourRow[] }>;
  getTrafficTotals(): Promise<{ rx: number; tx: number }>;
  getAppSummary(o: { from: number; to: number }): Promise<{ rows: AppSummaryItem[] }>;
  getAppHours(o: { uid: number; from: number; to: number }): Promise<{ rows: AppHourRow[] }>;
  getAppInfoList(): Promise<{ rows: AppInfoItem[] }>;
  getAppIcon(o: { packageName: string }): Promise<{ base64: string }>;
  openAppInfo(o: { packageName: string }): Promise<void>;
  deleteAllData(): Promise<void>;
  // v0.4
  setConfig(o: { json: string }): Promise<void>;
  getQuotaStatus(): Promise<QuotaStatus>;
  getTetherHours(o: { from: number; to: number }): Promise<{ rows: TetherRow[] }>;
  getHotspotState(): Promise<HotspotState>;
  openHotspotSettings(): Promise<void>;
  getCapabilities(): Promise<Capabilities>;
  getAppForeground(o: { uid: number; from: number; to: number }): Promise<{ supported: boolean; fg: number; bg: number }>;
  // v0.5
  requestVpn(): Promise<{ granted: boolean }>;
  getVpnState(): Promise<VpnState>;
  releaseAutoBlock(o: { pkg: string }): Promise<void>;
  openVpnSettings(): Promise<void>;
}

const native = registerPlugin<QuotaPlugin>('Quota');

const web: QuotaPlugin = {
  getPermissionStatus: async () => ({ usageAccess: false, notifications: false, batteryOptimizationIgnored: false }),
  openUsageAccessSettings: async () => {},
  requestNotifications: async () => ({ granted: false }),
  openBatterySettings: async () => {},
  startTracking: async () => {},
  syncNow: async () => ({ ok: false, rows: 0, mobileSupported: false, sdk: 0, message: 'Berjalan di browser: tidak ada data perangkat.' }),
  syncAppsNow: async () => ({ ok: false, rows: 0, mobileSupported: false, sdk: 0, message: 'Berjalan di browser.' }),
  getHours: async () => ({ rows: [] }),
  getTrafficTotals: async () => { throw new Error('Hanya tersedia di app Android.'); },
  getAppSummary: async () => ({ rows: [] }),
  getAppHours: async () => ({ rows: [] }),
  getAppInfoList: async () => ({ rows: [] }),
  getAppIcon: async () => ({ base64: '' }),
  openAppInfo: async () => {},
  deleteAllData: async () => {},
  setConfig: async () => {},
  getQuotaStatus: async () => { throw new Error('Hanya tersedia di app Android.'); },
  getTetherHours: async () => ({ rows: [] }),
  getHotspotState: async () => ({ active: false, kind: 'none', iface: '' }),
  openHotspotSettings: async () => {},
  getCapabilities: async () => ({ sdk: 0, mobileStats: false, foregroundSplit: false, tetherSeen: false, notifications: false }),
  getAppForeground: async () => ({ supported: false, fg: 0, bg: 0 }),
  requestVpn: async () => ({ granted: false }),
  getVpnState: async () => ({ prepared: false, running: false, blocked: 0, dropped: 0, otherVpn: false, revokedAt: 0, autoBlocked: [] }),
  releaseAutoBlock: async () => {},
  openVpnSettings: async () => {},
};

export const Quota: QuotaPlugin = Capacitor.isNativePlatform() ? native : web;
