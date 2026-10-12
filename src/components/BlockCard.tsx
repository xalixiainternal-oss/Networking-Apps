import { useState } from 'react';
import { Ban, ShieldAlert } from 'lucide-react';
import { Button, Card, Toggle } from './ui';
import type { AppRow } from '../lib/appUsage';
import { describeVpn, enableBlocking, hasAnyLimit, useVpnState } from '../lib/blocking';
import { Quota } from '../lib/quotaPlugin';
import { setBlockRule, useSettings } from '../lib/settings';

const fmtDate = (ms: number) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Kartu "Blokir internet" di halaman detail aplikasi. */
export function BlockCard({ row }: { row: AppRow }) {
  const st = useSettings();
  const vpn = useVpnState();
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const pkg = row.packageName;
  const rule = st.blockRules[pkg] ?? { label: row.label, cell: false, wifi: false, bg: false, autoBlock: false, hot: false };
  const set = (patch: Parameters<typeof setBlockRule>[2]) => setBlockRule(pkg, row.label, patch);
  const sum = describeVpn(st.blockOn, vpn);
  const auto = vpn?.autoBlocked.find((a) => a.pkg === pkg);
  const canAuto = hasAnyLimit(st, pkg);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1"><Ban size={20} strokeWidth={2.5} aria-hidden /><h2 className="m-0 text-lg font-bold">Blokir internet</h2></div>
      <p className="m-0 mb-3 text-sm leading-snug">
        Memakai <b>satu-satunya slot VPN</b> di HP (lokal, tanpa server, tidak ada data keluar). Selama aktif, VPN lain tidak bisa berjalan bersamaan
        dan ikon kunci muncul di status bar. Aplikasi yang diblokir akan terlihat menunggu atau gagal tersambung.
      </p>

      {!st.blockOn ? (
        <div className="grid gap-2">
          <Button onClick={async () => { setMsg(null); if (!(await enableBlocking())) setMsg('Izin VPN tidak diberikan, jadi pemblokiran tetap mati.'); }}>
            Aktifkan pemblokiran (memakai slot VPN)
          </Button>
          {msg && <p className="m-0 text-sm font-bold" role="alert">{msg}</p>}
        </div>
      ) : (
        <div className="grid gap-3">
          {row.isSystem && (
            <div className="nb-box bg-pink text-ink p-3 flex gap-2 items-start" role="alert" style={{ '--sh': '3px' } as React.CSSProperties}>
              <ShieldAlert size={18} strokeWidth={2.5} className="shrink-0 mt-0.5" aria-hidden />
              <span className="text-sm font-bold">Ini aplikasi sistem. Memblokirnya bisa mengganggu fungsi HP (telepon, notifikasi, pembaruan).</span>
            </div>
          )}
          <Toggle checked={rule.cell} onChange={(cell) => set({ cell })} label="Blokir saat memakai data seluler" />
          <Toggle checked={rule.wifi} onChange={(wifi) => set({ wifi })} label="Blokir saat memakai Wi-Fi" />
          <Toggle checked={rule.bg} onChange={(bg) => set({ bg })} label="Blokir saat di background"
            hint="Diblokir kapan pun tidak sedang di layar, termasuk saat layar mati. Pergantian aplikasi terdeteksi tiap sekitar 2 detik, jadi ada jeda singkat." />

          <Toggle checked={rule.hot} onChange={(hot) => set({ hot })} label="Blokir saat hotspot menyala"
            hint="Selama hotspot/tethering HP ini menyala, internet aplikasi ini di HP diblokir supaya kuota tidak habis sebelum dibagikan. Tidak memengaruhi perangkat yang tersambung ke hotspot." />

          <Toggle checked={rule.autoBlock} disabled={!canAuto && !rule.autoBlock}
            onChange={(on) => { if (on) setConfirmAuto(true); else set({ autoBlock: false }); }}
            label="Blokir otomatis saat batas terlewati"
            hint={canAuto ? 'Memakai batas harian/siklus aplikasi ini (di kartu atas).' : 'Atur dulu batas harian atau siklus aplikasi ini.'} />
          {confirmAuto && (
            <div className="nb-box bg-lilac text-ink p-3 grid gap-2" role="alertdialog" aria-label="Konfirmasi blokir otomatis" style={{ '--sh': '3px' } as React.CSSProperties}>
              <p className="m-0 text-sm font-bold">Aktifkan blokir otomatis untuk {row.label}?</p>
              <p className="m-0 text-sm">
                Begitu batas harian atau siklusnya terlewati, internet aplikasi ini <b>diblokir sampai periodenya berganti</b>. Ia bisa berhenti
                menerima pesan atau sinkron. Kamu bisa membukanya kapan saja dari sini atau dari Pengaturan.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => { set({ autoBlock: true }); setConfirmAuto(false); }}>Ya, aktifkan</Button>
                <Button variant="ghost" onClick={() => setConfirmAuto(false)}>Batal</Button>
              </div>
            </div>
          )}

          {auto && (
            <div className="nb-box bg-pink text-ink p-3 grid gap-2" role="status" style={{ '--sh': '3px' } as React.CSSProperties}>
              <p className="m-0 text-sm font-bold">DIBLOKIR OTOMATIS sampai {fmtDate(auto.until)}.</p>
              <Button variant="ghost" onClick={() => { void Quota.releaseAutoBlock({ pkg }); }}>Buka blokir sekarang</Button>
            </div>
          )}

          <p className="m-0 text-sm" aria-live="polite"><b>Status:</b> {sum.text}</p>
        </div>
      )}
    </Card>
  );
}
