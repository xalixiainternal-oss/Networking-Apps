import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { describeRule, describeVpn, disableBlocking, enableBlocking, useVpnState } from '../lib/blocking';
import { AmountField, Button, Card, FIELD, Seg, Toggle } from './ui';
import { Header } from './Header';
import { Quota, type PermissionStatus } from '../lib/quotaPlugin';
import { useCapabilities } from '../lib/hotspot';
import { applyTheme, setBlockRule, updateSettings, useSettings } from '../lib/settings';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function BlockSettings() {
  const s = useSettings();
  const vpn = useVpnState();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sum = describeVpn(s.blockOn, vpn);
  const rules = Object.entries(s.blockRules);
  return (
    <Card>
      <h2 className="m-0 mb-3 text-lg font-bold">Blokir aplikasi (VPN lokal)</h2>
      <Toggle checked={s.blockOn || confirm}
        onChange={(on) => { setMsg(null); if (on) setConfirm(true); else { setConfirm(false); disableBlocking(); } }}
        label="Aktifkan pemblokiran per aplikasi"
        hint="Aturan diatur di halaman detail tiap aplikasi (tab Aplikasi)." />
      {confirm && !s.blockOn && (
        <div className="nb-box bg-lilac text-ink p-3 grid gap-2 mt-3" role="alertdialog" aria-label="Konfirmasi pemblokiran" style={{ '--sh': '3px' } as React.CSSProperties}>
          <p className="m-0 text-sm font-bold">Sebelum diaktifkan, pahami ini:</p>
          <ul className="m-0 pl-5 text-sm grid gap-1">
            <li>Memakai <b>satu-satunya slot VPN</b>. VPN lain tidak bisa aktif bersamaan; Android akan meminta izin dan bisa mematikan VPN lain.</li>
            <li>Tetap lokal: tidak ada server dan tidak ada data keluar. Paket aplikasi yang diblokir hanya dibuang.</li>
            <li>Aplikasi yang tidak diblokir tidak melewati VPN, jadi kecepatan dan baterainya tidak terpengaruh.</li>
            <li>Aplikasi yang diblokir terlihat menunggu atau gagal tersambung, bukan langsung ditolak.</li>
          </ul>
          <div className="flex gap-2">
            <Button onClick={async () => { const ok = await enableBlocking(); setConfirm(false); if (!ok) setMsg('Izin VPN tidak diberikan, jadi pemblokiran tetap mati.'); }}>Lanjut ke izin VPN</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Batal</Button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 mb-0 font-bold" role="alert">{msg}</p>}
      {s.blockOn && (
        <div className="grid gap-3 mt-3">
          <p className="m-0 text-sm" aria-live="polite"><b>Status:</b> {sum.text}</p>
          {vpn && vpn.running && <p className="m-0 nb-label">PAKET DIBUANG SEJAK LAYANAN MULAI: {vpn.dropped.toLocaleString('id-ID')}</p>}
          <Button variant="ghost" onClick={() => { void Quota.openVpnSettings(); }}>Buka pengaturan VPN sistem</Button>
          <p className="m-0 text-xs opacity-80">
            Setelah HP restart, Android sering menolak layanan latar dimulai sendiri. Aktifkan <b>VPN selalu aktif</b> untuk Pantau Kuota di pengaturan VPN supaya pemblokiran langsung kembali.
          </p>
          {rules.length > 0 ? (
            <ul className="m-0 p-0 list-none grid gap-2">
              {rules.map(([pkg, r]) => (
                <li key={pkg} className="flex items-center gap-2 justify-between">
                  <span className="min-w-0"><span className="font-bold block truncate">{r.label}</span><span className="nb-label text-xs">{describeRule(r)}</span></span>
                  <Button variant="ghost" aria-label={`Hapus aturan ${r.label}`} onClick={() => setBlockRule(pkg, r.label, { cell: false, wifi: false, bg: false, autoBlock: false })}>Hapus</Button>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-sm">Belum ada aturan. Buka tab Aplikasi, ketuk sebuah aplikasi, lalu atur di kartu "Blokir internet".</p>}
          {vpn && vpn.autoBlocked.length > 0 && (
            <div className="grid gap-2">
              <p className="m-0 nb-label">DIBLOKIR OTOMATIS SAAT INI</p>
              {vpn.autoBlocked.map((a) => (
                <div key={a.pkg} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-bold">{s.blockRules[a.pkg]?.label ?? a.pkg}</span>
                  <Button variant="ghost" onClick={() => { void Quota.releaseAutoBlock({ pkg: a.pkg }); }}>Buka blokir</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Permissions() {
  const [p, setP] = useState<PermissionStatus | null>(null);
  const refresh = useCallback(() => { Quota.getPermissionStatus().then(setP).catch(() => setP(null)); }, []);
  useEffect(() => {
    refresh();
    const f = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [refresh]);
  if (!p) return null;
  const rows: { ok: boolean; name: string; why: string; fix: () => void; btn: string }[] = [
    { ok: p.usageAccess, name: 'Akses Penggunaan', why: 'Tanpa ini tidak ada data pemakaian.', btn: 'Buka pengaturan', fix: () => { void Quota.openUsageAccessSettings(); } },
    { ok: p.notifications, name: 'Notifikasi', why: 'Untuk peringatan 80/90/100% dan notifikasi tetap.', btn: 'Izinkan', fix: () => { void Quota.requestNotifications().then(refresh); } },
    { ok: p.batteryOptimizationIgnored, name: 'Bebas penghemat baterai', why: 'Sebagian HP mematikan layanan latar; pengecualian ini menjaga pencatatan dan notifikasi tetap hidup.', btn: 'Buka pengaturan baterai', fix: () => { void Quota.openBatterySettings(); } },
  ];
  return (
    <Card>
      <h2 className="m-0 mb-3 text-lg font-bold">Izin</h2>
      <div className="grid gap-3">
        {rows.map((r) => (
          <div key={r.name} className="grid gap-1">
            <div className="flex items-center gap-2 font-bold">
              {r.ok ? <Check size={18} strokeWidth={3} aria-label="aktif" /> : <X size={18} strokeWidth={3} aria-label="belum aktif" />}
              {r.name}<span className="nb-label ml-auto">{r.ok ? 'AKTIF' : 'BELUM'}</span>
            </div>
            <p className="m-0 text-sm opacity-80">{r.why}</p>
            {!r.ok && <Button variant="ghost" onClick={r.fix}>{r.btn}</Button>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Capabilities() {
  const c = useCapabilities();
  const st = useSettings();
  const vpn = useVpnState();
  const blockLive = st.blockOn && Boolean(vpn?.running);
  if (!c) return <Card><h2 className="m-0 mb-1 text-lg font-bold">Kemampuan perangkat ini</h2><p className="m-0 text-sm">Hanya tersedia di app Android.</p></Card>;
  const rows: [boolean, string, string][] = [
    [c.mobileStats, 'Data seluler', c.mobileStats ? 'Dibaca dari statistik sistem (semua SIM digabung).' : `Android ${c.sdk} (8–9) butuh izin telepon untuk data seluler; sengaja tidak diminta.`],
    [true, 'Pemakaian per aplikasi', 'Dari statistik sistem; riwayat disalin ke HP tiap jam.'],
    [c.foregroundSplit, 'Rasio foreground vs background', c.foregroundSplit ? 'Tersedia di halaman detail aplikasi.' : 'Butuh Android 9 ke atas.'],
    [c.tetherSeen, 'Pemakaian hotspot', c.tetherSeen ? 'Tercatat di statistik jaringan.' : 'Belum pernah terlihat di HP ini. Mungkin hotspot belum dipakai, atau pabrikan tidak mencatatnya.'],
    [c.notifications, 'Notifikasi peringatan', c.notifications ? 'Aktif.' : 'Izin notifikasi belum diberikan.'],
    [true, 'Notifikasi tetap', 'Layanan latar ringan; hanya berdetak saat layar menyala.'],
    [false, 'Matikan hotspot otomatis', 'Tidak mungkin: Android melarangnya untuk aplikasi biasa.'],
    [false, 'Perangkat terhubung ke hotspot', 'Tidak didukung tanpa root (tabel ARP dan data per klien tertutup).'],
    [false, 'Batas bandwidth hotspot', 'Tidak didukung tanpa root (trafik tethering tidak lewat VPN aplikasi).'],
    [blockLive, 'Blokir internet per aplikasi (VPN lokal)', st.blockOn ? describeVpn(true, vpn).text : 'Tersedia tanpa root, memakai slot VPN. Mati sampai kamu mengaktifkannya.'],
    [false, 'Batas kecepatan per aplikasi', 'Belum ada: v0.6, bila layak.'],
    [false, 'Mode Lanjutan (root/Shizuku)', 'Belum ada: eksperimental, v0.6.'],
  ];
  return (
    <Card>
      <h2 className="m-0 mb-3 text-lg font-bold">Kemampuan perangkat ini</h2>
      <p className="mt-0 mb-3 nb-label">ANDROID {c.sdk}</p>
      <ul className="m-0 p-0 list-none grid gap-3">
        {rows.map(([ok, name, why]) => (
          <li key={name} className="grid gap-0.5">
            <div className="flex items-center gap-2 font-bold">
              {ok ? <Check size={16} strokeWidth={3} aria-hidden /> : <X size={16} strokeWidth={3} aria-hidden />}
              {name}<span className="nb-label ml-auto">{ok ? 'AKTIF' : 'TIDAK AKTIF'}</span>
            </div>
            <p className="m-0 text-sm opacity-80 pl-6">{why}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <>
      <Header title="Pengaturan" />
      <div className="p-4 grid gap-4">
        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Paket data seluler</h2>
          <AmountField id="kuota" label="TOTAL KUOTA (0 = TANPA BATAS)" value={{ v: s.quotaValue, u: s.quotaUnit }}
            onChange={(a) => updateSettings({ quotaValue: a.v, quotaUnit: a.u })} />
          <label className="nb-label block mt-4 mb-1" htmlFor="reset">TANGGAL RESET SIKLUS (1–31)</label>
          <input id="reset" className={FIELD} type="number" inputMode="numeric" min={1} max={31} value={s.resetDay}
            onChange={(e) => updateSettings({ resetDay: Math.min(31, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} />
          <p className="mb-0 mt-2">Tanggal 31 otomatis menjadi hari terakhir di bulan yang lebih pendek.</p>
        </Card>

        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Kuota malam</h2>
          <Toggle checked={s.night.on} onChange={(on) => updateSettings({ night: { ...s.night, on } })}
            label="Pakai kuota malam" hint="Pemakaian seluler di jam malam dihitung dulu ke kuota malam, baru sisanya ke kuota utama." />
          {s.night.on && (
            <div className="grid gap-4 mt-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1"><span className="nb-label">MULAI</span>
                  <select className={FIELD} value={s.night.startHour} onChange={(e) => updateSettings({ night: { ...s.night, startHour: Number(e.target.value) } })}>
                    {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></label>
                <label className="grid gap-1"><span className="nb-label">SELESAI</span>
                  <select className={FIELD} value={s.night.endHour} onChange={(e) => updateSettings({ night: { ...s.night, endHour: Number(e.target.value) } })}>
                    {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></label>
              </div>
              <AmountField id="malam" label="KUOTA MALAM (0 = TIDAK DIPAKAI)" value={s.night.quota}
                onChange={(quota) => updateSettings({ night: { ...s.night, quota } })} />
              <p className="m-0 text-sm">Jendela dihitung per jam penuh dan boleh melewati tengah malam (mis. 22:00–06:00). Jika mulai = selesai, kuota malam tidak berlaku.</p>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Kuota Wi-Fi</h2>
          <AmountField id="wifi" label="BATAS WI-FI PER SIKLUS (0 = TANPA BATAS)" value={s.wifiQuota}
            onChange={(wifiQuota) => updateSettings({ wifiQuota })} />
          <p className="mb-0 mt-2 text-sm">Untuk Wi-Fi yang berkuota (mis. internet rumah). Dihitung dengan tanggal reset yang sama.</p>
        </Card>

        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Notifikasi</h2>
          <div className="grid gap-3">
            <Toggle checked={s.alerts} onChange={(alerts) => updateSettings({ alerts })}
              label="Peringatan 80%, 90%, 100%" hint="Untuk kuota, hotspot, dan batas per aplikasi. Tiap ambang hanya sekali per periode." />
            <Toggle checked={s.persistent} onChange={(persistent) => { updateSettings({ persistent }); if (persistent) void Quota.requestNotifications(); }}
              label="Notifikasi tetap" hint="Menampilkan kecepatan, pemakaian hari ini, dan sisa kuota. Memakai layanan latar yang hanya aktif saat layar menyala." />
          </div>
        </Card>

        <BlockSettings />
        <Permissions />
        <Capabilities />

        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Satuan</h2>
          <Seg label="Basis satuan" value={s.base} onChange={(base) => updateSettings({ base })}
            options={[[1000, 'Desimal (1000)'], [1024, 'Biner (1024)']]} />
        </Card>

        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Tema</h2>
          <Seg label="Tema" value={s.theme} onChange={(theme) => { updateSettings({ theme }); applyTheme(theme); }}
            options={[['system', 'Ikuti sistem'], ['light', 'Terang'], ['dark', 'Gelap']]} />
        </Card>

        <Card tone="pink">
          <h2 className="m-0 mb-2 text-lg font-bold">Hapus semua data</h2>
          <p className="mt-0">Menghapus seluruh riwayat pemakaian yang tersimpan di HP ini. Tidak bisa dibatalkan.</p>
          {!confirm && <Button variant="ghost" onClick={() => { setConfirm(true); setDone(false); }}>Hapus riwayat</Button>}
          {confirm && (
            <div className="flex gap-2">
              <Button onClick={async () => { await Quota.deleteAllData(); setConfirm(false); setDone(true); }}>Ya, hapus</Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>Batal</Button>
            </div>
          )}
          {done && <p className="mb-0 mt-2 font-bold">Riwayat dihapus. Pencatatan berlanjut dari data sistem yang tersedia.</p>}
        </Card>

        <Card><b>Belum ada:</b> ekspor CSV, batas kecepatan per aplikasi, dan mode root/Shizuku (v0.6).</Card>
      </div>
    </>
  );
}
