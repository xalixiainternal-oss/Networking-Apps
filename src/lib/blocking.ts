import { useEffect, useState } from 'react';
import { Quota, type VpnState } from './quotaPlugin';
import { updateSettings, type BlockRuleCfg, type Settings } from './settings';

export type VpnTone = 'mati' | 'ok' | 'perhatian';
export interface VpnSummary { tone: VpnTone; text: string }

/** Terjemahkan keadaan VPN + saklar utama jadi satu kalimat jujur untuk pengguna. */
export function describeVpn(blockOn: boolean, v: VpnState | null): VpnSummary {
  if (!blockOn) return { tone: 'mati', text: 'Pemblokiran mati. Aturan yang sudah kamu atur tetap tersimpan.' };
  if (!v) return { tone: 'perhatian', text: 'Status VPN tidak bisa dibaca (hanya tersedia di app Android).' };
  if (!v.prepared) return { tone: 'perhatian', text: 'Izin VPN belum diberikan, jadi belum ada yang diblokir.' };
  if (!v.running && v.otherVpn) return { tone: 'perhatian', text: 'VPN lain sedang aktif. Slot VPN hanya satu, jadi pemblokiran tidak bisa berjalan bersamaan.' };
  if (!v.running && v.revokedAt > 0) return { tone: 'perhatian', text: 'Pemblokiran berhenti karena izin dicabut atau slot VPN diambil VPN lain. Aktifkan lagi.' };
  if (!v.running) return { tone: 'perhatian', text: 'Layanan pemblokir belum berjalan. Buka ulang aplikasi, atau aktifkan "VPN selalu aktif" di pengaturan sistem.' };
  return v.blocked > 0
    ? { tone: 'ok', text: `Berjalan: ${v.blocked} aplikasi sedang diblokir.` }
    : { tone: 'ok', text: 'Berjalan, tapi tidak ada aplikasi yang harus diblokir saat ini (sesuai jaringan dan aturanmu).' };
}

/** Ringkasan aturan satu aplikasi, mis. "Seluler · Background". */
export function describeRule(r: Pick<BlockRuleCfg, 'cell' | 'wifi' | 'bg' | 'autoBlock'>): string {
  const parts: string[] = [];
  if (r.cell) parts.push('Seluler');
  if (r.wifi) parts.push('Wi-Fi');
  if (r.bg) parts.push('Background');
  if (r.autoBlock) parts.push('Otomatis saat batas');
  return parts.join(' · ');
}

export function useVpnState(everyMs = 3000) {
  const [v, setV] = useState<VpnState | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      Quota.getVpnState().then((s) => { if (alive) setV(s); }).catch(() => { if (alive) setV(null); });
    };
    tick();
    const id = setInterval(tick, everyMs);
    return () => { alive = false; clearInterval(id); };
  }, [everyMs]);
  return v;
}

/** Minta izin VPN ke sistem (dialog milik Android). Saklar utama baru menyala bila izin diberikan. */
export async function enableBlocking(): Promise<boolean> {
  try {
    const r = await Quota.requestVpn();
    if (r.granted) { updateSettings({ blockOn: true }); return true; }
  } catch { /* di browser atau dibatalkan */ }
  return false;
}

export const disableBlocking = () => updateSettings({ blockOn: false });

export const hasAnyLimit = (s: Settings, pkg: string) => {
  const l = s.appLimits[pkg];
  return Boolean(l && (l.daily.v > 0 || l.monthly.v > 0));
};
