import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, LockKeyhole, X } from 'lucide-react';
import { describeRule, describeVpn, disableBlocking, enableBlocking, useVpnState } from '../lib/blocking';
import { AmountField, Button, Card, FIELD, Seg, Toggle } from './ui';
import { Header } from './Header';
import { Quota, ShizukuControl, type BlockerBackend, type PermissionStatus, type ShizukuGrantResult, type ShizukuStatus } from '../lib/quotaPlugin';
import { useCapabilities } from '../lib/hotspot';
import { applyTheme, setBlockRule, updateSettings, useSettings } from '../lib/settings';
import { isWithinDailyWindow, sanitizeUssd, ussdHref } from '../lib/insights';
import { useNow } from '../lib/hooks';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function BlockSettings() {
  const s = useSettings();
  const vpn = useVpnState();
  const [backend, setBackend] = useState<BlockerBackend | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => ShizukuControl.getBlockerBackend().then((b) => { if (alive) setBackend(b); }).catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const sum = s.blockOn && backend?.active === 'shizuku'
    ? { tone: 'ok' as const, text: `Shizuku aktif: ${vpn?.blocked ?? 0} aplikasi diblokir.` }
    : describeVpn(s.blockOn, vpn);
  const rules = Object.entries(s.blockRules);
  return (
    <Card>
      <h2 className="m-0 mb-3 text-lg font-bold">Blokir aplikasi</h2>
      <Toggle checked={s.blockOn || confirm}
        onChange={(on) => { setMsg(null); if (on) setConfirm(true); else { setConfirm(false); disableBlocking(); } }}
        label="Aktifkan pemblokiran per aplikasi"
        hint="Aturan diatur di halaman detail tiap aplikasi (tab Aplikasi)." />
      {confirm && !s.blockOn && (
        <div className="nb-box bg-lilac text-ink p-3 grid gap-2 mt-3" role="alertdialog" aria-label="Konfirmasi pemblokiran" style={{ '--sh': '3px' } as React.CSSProperties}>
          <p className="m-0 text-sm font-bold">Sebelum diaktifkan, pahami ini:</p>
          <ul className="m-0 pl-5 text-sm grid gap-1">
            <li>Memerlukan izin VPN lokal sebagai jalur fallback. Jika Shizuku aktif dan firewall perangkat mendukungnya, aplikasi mencoba memakai Shizuku terlebih dahulu.</li>
            <li>Tetap lokal: tidak ada server dan tidak ada data keluar. Paket aplikasi yang diblokir hanya dibuang.</li>
            <li>Aplikasi yang tidak diblokir tidak melewati VPN, jadi kecepatan dan baterainya tidak terpengaruh.</li>
            <li>Pemblokiran Shizuku/VPN dapat membuat aplikasi target gagal tersambung; uji hanya dengan aplikasi non-esensial.</li>
          </ul>
          <div className="flex gap-2">
            <Button onClick={async () => { const ok = await enableBlocking(); setConfirm(false); if (!ok) setMsg('Izin VPN fallback belum tersedia, jadi pemblokiran tetap mati.'); }}>Lanjutkan</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Batal</Button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 mb-0 font-bold" role="alert">{msg}</p>}
      {s.blockOn && (
        <div className="grid gap-3 mt-3">
          <p className="m-0 text-sm" aria-live="polite"><b>Status:</b> {sum.text}</p>
          {vpn && vpn.running && backend?.active !== 'shizuku' && <p className="m-0 nb-label">PAKET DIBUANG SEJAK LAYANAN MULAI: {vpn.dropped.toLocaleString('id-ID')}</p>}
          {backend?.active !== 'shizuku' && <Button variant="ghost" onClick={() => { void Quota.openVpnSettings(); }}>Buka pengaturan VPN sistem</Button>}
          {backend?.active === 'shizuku'
            ? <p className="m-0 text-xs opacity-80">Jika Shizuku berhenti setelah restart, jalankan kembali Shizuku dan buka aplikasi. VPN lokal tetap disiapkan sebagai fallback.</p>
            : <p className="m-0 text-xs opacity-80">Setelah HP restart, Android sering menolak layanan latar dimulai sendiri. Aktifkan <b>VPN selalu aktif</b> untuk Xai Network di pengaturan VPN supaya pemblokiran kembali otomatis.</p>}
          {backend && <p className="m-0 mt-2 nb-label">BACKEND SAAT INI: {backend.active.toUpperCase()}{backend.fallback ? ' · FALLBACK' : ''}</p>}
          {rules.length > 0 ? (
            <ul className="m-0 p-0 list-none grid gap-2">
              {rules.map(([pkg, r]) => (
                <li key={pkg} className="flex items-center gap-2 justify-between">
                  <span className="min-w-0"><span className="font-bold block truncate">{r.label}</span><span className="nb-label text-xs">{describeRule(r)}</span></span>
                  <Button variant="ghost" aria-label={`Hapus aturan ${r.label}`} onClick={() => setBlockRule(pkg, r.label, { cell: false, wifi: false, bg: false, autoBlock: false, hot: false })}>Hapus</Button>
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

function ShizukuSettings() {
  const s = useSettings();
  const [status, setStatus] = useState<ShizukuStatus | null>(null);
  const [grants, setGrants] = useState<ShizukuGrantResult[]>([]);
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => {
    ShizukuControl.getShizukuStatus().then(setStatus).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Status Shizuku tidak dapat dibaca.');
    });
  }, []);
  useEffect(() => {
    refresh();
    let active = true;
    let remove: (() => Promise<void>) | undefined;
    ShizukuControl.addListener('shizukuStateChange', (next) => { if (active) setStatus(next); })
      .then((handle) => { if (active) remove = handle.remove; else void handle.remove(); })
      .catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (remove) void remove();
    };
  }, [refresh]);

  return (
    <Card>
      <h2 className="m-0 mb-3 text-lg font-bold">Metode pemblokiran</h2>
      <Seg label="Backend pemblokiran" value={s.blockerMode}
        onChange={(blockerMode) => updateSettings({ blockerMode })}
        options={[
          ['auto', 'Otomatis'],
          ['vpn', 'VPN lokal'],
          ['shizuku', 'Shizuku'],
        ]} />
      <p className="mb-0 mt-2 text-sm">
        Otomatis memakai firewall Shizuku jika siap dan didukung perangkat, selain itu memakai VPN lokal. Shizuku membutuhkan aplikasi Shizuku yang berjalan dan izin eksplisit. Perintah firewall berbeda antarversi Android/OEM.
      </p>
      <p className="mb-2 mt-3 font-bold" role="status" aria-live="polite">
        Status Shizuku: {status?.message ?? 'Memeriksa…'}
      </p>
      {status?.state === 'not_installed' || status?.state === 'not_running' ? (
        <Button variant="ghost" onClick={() => { void ShizukuControl.openShizuku().catch((e: unknown) => setMessage(e instanceof Error ? e.message : 'Shizuku tidak dapat dibuka.')); }}>
          Buka / pasang Shizuku
        </Button>
      ) : null}
      {status?.state === 'permission_required' && (
        <Button onClick={() => {
          setMessage('');
          void ShizukuControl.requestShizukuPermission().then((r) => {
            setMessage(r.granted ? 'Izin Shizuku diberikan.' : (r.message ?? 'Izin Shizuku belum diberikan.'));
            refresh();
          }).catch((e: unknown) => setMessage(e instanceof Error ? e.message : 'Permintaan izin gagal.'));
        }}>Minta izin Shizuku</Button>
      )}
      {status?.ready && (
        <Button variant="ghost" onClick={() => {
          setMessage('');
          void ShizukuControl.grantRequiredPermissions().then((r) => setGrants(r.results))
            .catch((e: unknown) => setMessage(e instanceof Error ? e.message : 'Pemberian izin otomatis gagal.'));
        }}>Coba beri izin yang diperlukan</Button>
      )}
      {message && <p className="mb-0 mt-2 font-bold" role="alert">{message}</p>}
      {grants.length > 0 && (
        <ul className="m-0 mt-3 p-0 list-none grid gap-2" aria-label="Hasil pemberian izin">
          {grants.map((grant) => (
            <li key={grant.name} className="grid gap-1">
              <b>{grant.granted ? '✓' : '×'} {grant.name}</b>
              <span className="text-sm">{grant.message}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 mt-4">
        <p className="m-0 nb-label">AKSI KESELAMATAN · SEMUA MATI SECARA DEFAULT</p>
        {s.blockerMode === 'vpn' && <p className="m-0 text-sm" role="status">Aksi ini memerlukan backend Otomatis/Shizuku yang siap.</p>}
        <Toggle checked={s.safety.disableMobileData}
          onChange={(disableMobileData) => updateSettings({ safety: { ...s.safety, disableMobileData } })}
          label="Matikan data seluler saat kuota siklus habis"
          hint="Dijalankan saat jaringan aktif adalah seluler. Pemulihan otomatis hanya dilakukan untuk tindakan yang tercatat aplikasi."
          disabled={s.blockerMode === 'vpn'} />
        <Toggle checked={s.safety.stopHotspot}
          onChange={(stopHotspot) => updateSettings({ safety: { ...s.safety, stopHotspot } })}
          label="Hentikan hotspot saat kuota siklus habis"
          hint="Didukung hanya bila perintah sistem tersedia; bisa perlu dinyalakan kembali secara manual."
          disabled={s.blockerMode === 'vpn'} />
        <Toggle checked={s.safety.stopLimitedApps}
          onChange={(stopLimitedApps) => updateSettings({ safety: { ...s.safety, stopLimitedApps } })}
          label="Hentikan aplikasi saat batas aplikasinya habis"
          hint="Tidak pernah menargetkan aplikasi sistem, aplikasi ini, launcher, dialer, atau aplikasi darurat."
          disabled={s.blockerMode === 'vpn'} />
      </div>
    </Card>
  );
}

function BlockScheduleSettings() {
  const s = useSettings();
  const now = useNow(30_000);
  const active = isWithinDailyWindow(s.blockSchedule.start, s.blockSchedule.end, now);
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Clock3 size={20} strokeWidth={2.5} aria-hidden />
        <h2 className="m-0 text-lg font-bold">Jadwal blokir otomatis</h2>
      </div>
      <Toggle checked={s.blockSchedule.enabled}
        onChange={(enabled) => updateSettings({ blockSchedule: { ...s.blockSchedule, enabled } })}
        label="Ikuti jadwal blokir"
        hint="Berulang setiap hari. Saklar utama pemblokiran juga harus aktif; jadwal memakai waktu lokal perangkat." />
      {s.blockOn && (
        <p className="m-0 mt-2 nb-label" role="status">
          {!s.blockSchedule.enabled ? 'JADWAL MATI · BLOKIR MENGIKUTI ATURAN TANPA JADWAL.'
            : active ? 'DALAM RENTANG · BLOKIR AKTIF SESUAI ATURAN APLIKASI.'
              : 'DI LUAR RENTANG · PEMBLOKIRAN DIJEDA.'}
        </p>
      )}
      {s.blockSchedule.enabled && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <label className="grid gap-1">
            <span className="nb-label">MULAI</span>
            <input className={FIELD} type="time" value={s.blockSchedule.start}
              onChange={(e) => updateSettings({ blockSchedule: { ...s.blockSchedule, start: e.target.value } })} />
          </label>
          <label className="grid gap-1">
            <span className="nb-label">SELESAI</span>
            <input className={FIELD} type="time" value={s.blockSchedule.end}
              onChange={(e) => updateSettings({ blockSchedule: { ...s.blockSchedule, end: e.target.value } })} />
          </label>
          <p className="col-span-2 m-0 text-sm">
            Contoh 08:00–15:00 memblokir hanya pada rentang tersebut. Rentang boleh melewati tengah malam; waktu mulai sama dengan selesai berarti tidak ada waktu blokir.
          </p>
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
  const [shizukuReady, setShizukuReady] = useState(false);
  useEffect(() => {
    let alive = true;
    ShizukuControl.getShizukuStatus().then((status) => { if (alive) setShizukuReady(status.ready); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const blockLive = st.blockOn && Boolean(vpn?.running);
  if (!c) return <Card><h2 className="m-0 mb-1 text-lg font-bold">Kemampuan perangkat ini</h2><p className="m-0 text-sm">Hanya tersedia di app Android.</p></Card>;
  const rows: [boolean, string, string][] = [
    [c.mobileStats, 'Data seluler', c.mobileStats ? 'Dibaca dari statistik sistem (semua SIM digabung).' : `Android ${c.sdk} (8–9) butuh izin telepon untuk data seluler; sengaja tidak diminta.`],
    [true, 'Pemakaian per aplikasi', 'Dari statistik sistem; riwayat disalin ke HP tiap jam.'],
    [c.foregroundSplit, 'Rasio foreground vs background', c.foregroundSplit ? 'Tersedia di halaman detail aplikasi.' : 'Butuh Android 9 ke atas.'],
    [c.tetherSeen, 'Pemakaian hotspot', c.tetherSeen ? 'Tercatat di statistik jaringan.' : 'Belum pernah terlihat di HP ini. Mungkin hotspot belum dipakai, atau pabrikan tidak mencatatnya.'],
    [c.notifications, 'Notifikasi peringatan', c.notifications ? 'Aktif.' : 'Izin notifikasi belum diberikan.'],
    [true, 'Notifikasi tetap', 'Layanan latar ringan; hanya berdetak saat layar menyala.'],
    [shizukuReady, 'Kontrol hotspot melalui Shizuku', shizukuReady ? 'Shizuku siap; perintah penghentian hotspot tetap bergantung OEM dan perlu diuji.' : 'Perlu Shizuku aktif serta opt-in di Pengaturan.'],
    [false, 'Perangkat terhubung ke hotspot', 'Tidak didukung tanpa root (tabel ARP dan data per klien tertutup).'],
    [false, 'Batas bandwidth hotspot', 'Tidak didukung tanpa root (trafik tethering tidak lewat VPN aplikasi).'],
    [blockLive, 'Blokir internet per aplikasi', st.blockOn ? describeVpn(true, vpn).text : 'Tersedia melalui Shizuku atau VPN lokal fallback. Mati sampai kamu mengaktifkannya.'],
    [false, 'Batas kecepatan per aplikasi', 'Belum ada: v0.8, bila layak.'],
    [shizukuReady, 'Pemblokiran Shizuku', shizukuReady ? 'Siap; dukungan firewall per perangkat tetap diuji runtime.' : 'Belum siap; VPN lokal tersedia sebagai fallback.'],
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

function SettingsContent() {
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
          <h2 className="m-0 mb-3 text-lg font-bold">Cek kuota operator (USSD)</h2>
          <label className="nb-label block mb-1" htmlFor="ussd">KODE USSD (MIS. *123#)</label>
          <input id="ussd" className={FIELD} type="text" inputMode="tel" autoComplete="off" placeholder="*123#"
            value={s.ussd} onChange={(e) => updateSettings({ ussd: sanitizeUssd(e.target.value) })} />
          <p className="mb-0 mt-2 text-sm">
            {s.ussd && !ussdHref(s.ussd) ? 'Kode harus diawali * atau # dan diakhiri #.'
              : 'Tombol di Dashboard membuka dialer dengan kode ini; kamu tinggal menekan panggil. Kode berbeda tiap operator.'}
          </p>
        </Card>

        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Batas harian seluler</h2>
          <div className="grid gap-4">
            <AmountField id="batas-harian" label="BATAS PER HARI (0 = TIDAK DIPAKAI)" value={s.dailyLimit.quota}
              onChange={(quota) => updateSettings({ dailyLimit: { ...s.dailyLimit, quota } })} />
            {s.dailyLimit.quota.v > 0 && (
              <>
                <AmountField id="batas-harian-langkah" label="PERINGATAN TIAP KELIPATAN SETELAH BATAS LEWAT" value={s.dailyLimit.step}
                  onChange={(step) => updateSettings({ dailyLimit: { ...s.dailyLimit, step } })} />
                <AmountField id="batas-harian-cutoff" label="MATIKAN DATA SETELAH LEWAT SEBESAR (0 = JANGAN)" value={s.dailyLimit.cutoff}
                  onChange={(cutoff) => updateSettings({ dailyLimit: { ...s.dailyLimit, cutoff } })} />
                <p className="m-0 text-sm">
                  Contoh: batas 1 GB dan langkah 200 MB → peringatan di 1 GB, lalu tiap tambahan 200 MB. Bila "matikan data" diisi, data seluler dimatikan otomatis setelah pemakaian melewati batas sebesar itu dan dinyalakan lagi besok. Pemutusan otomatis butuh Shizuku siap; tanpa itu hanya ada peringatan. Peringatan mengikuti saklar notifikasi di bawah dan bisa tertunda sampai data disinkronkan.
                </p>
              </>
            )}
          </div>
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
              label="Peringatan 80%, 90%, 100%" hint="Untuk kuota, batas harian, hotspot, dan batas per aplikasi. Tiap ambang hanya sekali per periode; batas harian juga memberi peringatan tiap kelipatan setelah terlewati." />
            <Toggle checked={s.persistent} onChange={(persistent) => { updateSettings({ persistent }); if (persistent) void Quota.requestNotifications(); }}
              label="Notifikasi tetap" hint="Menampilkan kecepatan, pemakaian hari ini, dan sisa kuota. Memakai layanan latar yang hanya aktif saat layar menyala." />
          </div>
        </Card>

        <ShizukuSettings />
        <BlockSettings />
        <BlockScheduleSettings />
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

        <Card><b>Belum ada:</b> ekspor CSV dan batas kecepatan per aplikasi.</Card>
      </div>
    </>
  );
}

const PIN_KEY = 'settings.pin.v1';
const pinValid = (pin: string) => /^\d{4,8}$/.test(pin);

async function hashPin(pin: string, salt: string): Promise<string> {
  if (!crypto.subtle) throw new Error('Perangkat tidak mendukung penyimpanan PIN yang aman.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function createPinRecord(pin: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `v1:${salt}:${await hashPin(pin, salt)}`;
}

async function verifyPin(pin: string, record: string): Promise<boolean> {
  const [version, salt, expected, extra] = record.split(':');
  if (version !== 'v1' || !salt || !expected || extra !== undefined) {
    throw new Error('Data PIN tidak valid. Hapus data aplikasi untuk mengatur ulang PIN.');
  }
  return (await hashPin(pin, salt)) === expected;
}

function PinManagement({ onRecord }: { onRecord: (record: string) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const changePin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!pinValid(next)) { setError('PIN baru harus terdiri dari 4–8 angka.'); return; }
    if (next !== confirmation) { setError('Konfirmasi PIN tidak sama.'); return; }
    setBusy(true);
    try {
      const stored = localStorage.getItem(PIN_KEY);
      if (!stored || !(await verifyPin(current, stored))) { setError('PIN saat ini salah.'); return; }
      const record = await createPinRecord(next);
      localStorage.setItem(PIN_KEY, record);
      onRecord(record);
      setCurrent(''); setNext(''); setConfirmation(''); setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PIN tidak dapat diperbarui.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="m-0 mb-2 text-lg font-bold">Keamanan PIN</h2>
      {!open ? <Button variant="ghost" onClick={() => { setError(''); setOpen(true); }}>Ubah PIN Pengaturan</Button> : (
        <form className="grid gap-3" onSubmit={(e) => { void changePin(e); }}>
          <label className="grid gap-1"><span className="nb-label">PIN SAAT INI</span>
            <input className={FIELD} type="password" inputMode="numeric" autoComplete="current-password" maxLength={8} value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
          <label className="grid gap-1"><span className="nb-label">PIN BARU (4–8 ANGKA)</span>
            <input className={FIELD} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
          <label className="grid gap-1"><span className="nb-label">ULANGI PIN BARU</span>
            <input className={FIELD} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirmation} onChange={(e) => setConfirmation(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
          {error && <p className="m-0 font-bold" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan PIN baru'}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
          </div>
        </form>
      )}
      <p className="mb-0 mt-2 text-sm">PIN mengunci tampilan Pengaturan saat halaman dibuka. Ini bukan pengganti kunci layar Android.</p>
    </Card>
  );
}

function SettingsPinGate() {
  const [record, setRecord] = useState(() => localStorage.getItem(PIN_KEY));
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = record === null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!pinValid(pin)) { setError('PIN harus terdiri dari 4–8 angka.'); return; }
    if (setup && pin !== confirmation) { setError('Konfirmasi PIN tidak sama.'); return; }
    setBusy(true);
    try {
      if (setup) {
        const value = await createPinRecord(pin);
        localStorage.setItem(PIN_KEY, value);
        setRecord(value);
        setUnlocked(true);
      } else if (await verifyPin(pin, record)) {
        setUnlocked(true);
      } else {
        setError('PIN salah. Coba lagi.');
      }
      setPin('');
      setConfirmation('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PIN tidak dapat diverifikasi.');
    } finally {
      setBusy(false);
    }
  };

  if (unlocked && record) {
    return (
      <>
        <SettingsContent />
        <div className="p-4 pt-0"><PinManagement onRecord={setRecord} /></div>
      </>
    );
  }

  return (
    <>
      <Header title="Pengaturan" />
      <main className="min-h-[70vh] grid place-items-center p-5">
        <section className="nb-box nb-outline-ink bg-radar text-ink p-5 w-full max-w-sm grid gap-4" style={{ '--sh': '7px' } as React.CSSProperties}>
          <div className="grid justify-items-center gap-2 text-center">
            <LockKeyhole size={42} strokeWidth={3} aria-hidden />
            <h1 className="m-0 text-2xl font-bold uppercase">{setup ? 'Buat PIN Pengaturan' : 'Pengaturan Terkunci'}</h1>
            <p className="m-0 font-bold uppercase">{setup ? 'Buat PIN 4–8 angka untuk melindungi perubahan pengaturan.' : 'Masukkan PIN untuk melanjutkan.'}</p>
          </div>
          <form className="grid gap-3" onSubmit={(e) => { void submit(e); }}>
            <label className="grid gap-1">
              <span className="nb-label">{setup ? 'BUAT PIN' : 'PIN'}</span>
              <input autoFocus className={FIELD} type="password" inputMode="numeric" autoComplete={setup ? 'new-password' : 'current-password'}
                maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </label>
            {setup && (
              <label className="grid gap-1">
                <span className="nb-label">ULANGI PIN</span>
                <input className={FIELD} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8}
                  value={confirmation} onChange={(e) => setConfirmation(e.target.value.replace(/\D/g, '').slice(0, 8))} />
              </label>
            )}
            {error && <p className="m-0 font-bold" role="alert">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? 'Memeriksa…' : setup ? 'Simpan PIN & buka' : 'Buka Pengaturan'}</Button>
          </form>
          <p className="m-0 text-xs font-bold">PIN hanya mengunci antarmuka aplikasi, bukan kunci layar Android. Jika lupa, hapus data aplikasi untuk mengatur ulang.</p>
        </section>
      </main>
    </>
  );
}

export function SettingsPage() {
  return <SettingsPinGate />;
}
