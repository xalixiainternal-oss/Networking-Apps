import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Bell, BatteryCharging, Check, ShieldCheck } from 'lucide-react';
import { Quota, type PermissionStatus } from '../lib/quotaPlugin';
import { Button, Card, Plate } from './ui';

type Item = { key: keyof PermissionStatus; judul: string; alasan: string; Icon: typeof Bell; aksi: string; wajib: boolean };

const ITEMS: Item[] = [
  { key: 'usageAccess', judul: 'Akses Penggunaan', Icon: BarChart3, wajib: true,
    alasan: 'Android menyimpan catatan berapa data yang dipakai tiap aplikasi. Izin ini membuat app bisa MEMBACA catatan itu. Tanpa izin ini, app tidak bisa menampilkan apa pun. Data tidak keluar dari HP.',
    aksi: 'Buka pengaturan' },
  { key: 'notifications', judul: 'Notifikasi', Icon: Bell, wajib: false,
    alasan: 'Dipakai untuk peringatan saat kuota, hotspot, atau batas aplikasi mencapai 80%, 90%, dan 100%, dan untuk notifikasi tetap berisi kecepatan dan sisa kuota (bisa dimatikan di Pengaturan).',
    aksi: 'Izinkan notifikasi' },
  { key: 'batteryOptimizationIgnored', judul: 'Bebas penghemat baterai', Icon: BatteryCharging, wajib: false,
    alasan: 'Sebagian HP mematikan layanan latar secara paksa. Pengecualian ini menjaga pencatatan per jam tetap berjalan.',
    aksi: 'Buka pengaturan baterai' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [st, setSt] = useState<PermissionStatus | null>(null);
  const refresh = useCallback(() => { Quota.getPermissionStatus().then(setSt).catch(() => setSt(null)); }, []);
  useEffect(() => {
    refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); }; // kembali dari layar pengaturan
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const act = async (k: keyof PermissionStatus) => {
    if (k === 'usageAccess') await Quota.openUsageAccessSettings();
    else if (k === 'notifications') { await Quota.requestNotifications(); refresh(); }
    else await Quota.openBatterySettings();
  };

  return (
    <main className="grad-3 min-h-full safe-top safe-bottom p-4 pb-10">
      <Plate className="mt-4"><h1 className="text-3xl font-bold leading-tight m-0">Pantau Kuota</h1></Plate>
      <Plate className="mt-3 block"><p className="m-0 font-bold">Data kamu tetap di HP ini. App tidak punya izin internet.</p></Plate>

      <div className="mt-6 grid gap-4">
        {ITEMS.map(({ key, judul, alasan, Icon, aksi, wajib }) => {
          const ok = st?.[key] ?? false;
          return (
            <Card key={key}>
              <div className="flex items-center gap-3">
                <Icon size={28} strokeWidth={2.5} aria-hidden />
                <h2 className="m-0 text-xl font-bold flex-1">{judul}</h2>
                <span className="nb-label bg-pink text-ink nb-box px-2" style={{ ['--sh' as string]: '2px' }}>
                  {ok ? <><Check size={14} strokeWidth={3} className="inline" aria-hidden /> AKTIF</> : wajib ? 'WAJIB' : 'OPSIONAL'}
                </span>
              </div>
              <p className="mt-2 mb-3 leading-relaxed">{alasan}</p>
              {!ok && <Button onClick={() => act(key)}>{aksi}</Button>}
            </Card>
          );
        })}

        <Card tone="pink">
          <div className="flex items-center gap-2"><ShieldCheck size={22} strokeWidth={2.5} aria-hidden /><b>Izin lain, diminta nanti</b></div>
          <p className="mt-2 mb-0 leading-relaxed">
            Izin daftar aplikasi terpasang, layanan latar untuk notifikasi tetap, dan mulai otomatis saat HP menyala sudah tercantum di app ini dan tidak memunculkan dialog. Izin VPN untuk fitur blokir baru diminta saat kamu mengaktifkan pemblokiran, lewat dialog milik Android. Izin yang tidak dipakai tidak diminta.
          </p>
        </Card>

        <Button className="w-full text-lg" disabled={!st?.usageAccess} onClick={onDone}
          aria-disabled={!st?.usageAccess}>
          {st?.usageAccess ? 'Mulai' : 'Aktifkan Akses Penggunaan dulu'}
        </Button>
      </div>
    </main>
  );
}
