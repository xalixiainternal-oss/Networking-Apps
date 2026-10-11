import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Ban, ExternalLink, Info, Radio, RefreshCw, Users } from 'lucide-react';
import { Header } from './Header';
import { AmountField, Button, Card, GradCard, Plate, ProgressBar } from './ui';
import { HotspotChart } from './Chart';
import { useHotspotState, useTether, sumTether, tetherSeries, HOTSPOT_KIND_LABEL } from '../lib/hotspot';
import { useNow } from '../lib/hooks';
import { findItem, useQuotaStatus } from '../lib/quotaStatus';
import { Quota } from '../lib/quotaPlugin';
import { updateSettings, useSettings } from '../lib/settings';
import { HOUR, addLocalDays, cycleRange, fmtBytes, startOfLocalDay, type Bytes } from '../lib/usage';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });

function Line({ title, b, base }: { title: string; b: Bytes; base: 1000 | 1024 }) {
  return (
    <div className="grid gap-1">
      <div className="nb-label">{title}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="nb-num text-2xl">{fmtBytes(b.rx + b.tx, base)}</span>
        <span className="nb-num flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1"><ArrowDown size={14} strokeWidth={3} aria-label="unduh" />{fmtBytes(b.rx, base)}</span>
          <span className="flex items-center gap-1"><ArrowUp size={14} strokeWidth={3} aria-label="unggah" />{fmtBytes(b.tx, base)}</span>
        </span>
      </div>
    </div>
  );
}

export function HotspotPage() {
  const st = useSettings();
  const now = useNow();
  const { rows, loading, note, reload } = useTether();
  const hs = useHotspotState();
  const { status } = useQuotaStatus(rows);
  const [mode, setMode] = useState<'jam' | 'hari'>('jam');

  const d = useMemo(() => {
    const t0 = startOfLocalDay(now), tEnd = now + HOUR, cyc = cycleRange(now, st.resetDay);
    return {
      cyc,
      today: sumTether(rows, t0, tEnd),
      week: sumTether(rows, addLocalDays(t0, -6), tEnd),
      cycle: sumTether(rows, cyc.start, cyc.end),
      hourly: tetherSeries(rows, t0, 24, 'hour'),
      daily: tetherSeries(rows, addLocalDays(t0, -29), 30, 'day'),
    };
  }, [rows, st.resetDay, now]);

  const day = findItem(status, 'hotspot.day');
  const cyc = findItem(status, 'hotspot.cycle');
  const openSettings = () => { Quota.openHotspotSettings().catch(() => {}); };

  return (
    <>
      <Header title="Hotspot" />
      <div className="p-4 grid gap-4">

        {/* status hotspot */}
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <Radio size={22} strokeWidth={2.5} aria-hidden />
            <h2 className="m-0 text-lg font-bold">Status hotspot</h2>
          </div>
          <p className="m-0 nb-num text-xl" aria-live="polite">
            {hs ? (hs.active ? `AKTIF · ${HOTSPOT_KIND_LABEL[hs.kind]}` : 'TIDAK TERDETEKSI') : 'MENGUKUR…'}
          </p>
          <p className="mt-2 mb-3 text-sm opacity-80 leading-snug">
            Ini perkiraan dari antarmuka jaringan yang menyala, bukan jawaban resmi sistem (Android tidak menyediakannya untuk aplikasi biasa).
            Aplikasi ini <b>tidak bisa mematikan hotspot otomatis</b>: Android melarangnya. Saat batas tercapai, kamu hanya diberi notifikasi.
          </p>
          <Button onClick={openSettings} className="w-full flex items-center justify-center gap-2">
            <ExternalLink size={18} strokeWidth={2.5} aria-hidden />Buka pengaturan hotspot
          </Button>
        </Card>

        {note && (
          <Card tone="pink">
            <div className="flex gap-2 items-start"><Info size={18} strokeWidth={2.5} className="shrink-0 mt-0.5" aria-hidden /><span className="text-sm">{note}</span></div>
            <Button className="mt-3" variant="ghost" onClick={reload}>Coba lagi</Button>
          </Card>
        )}

        {/* total */}
        <GradCard>
          <div className="grid gap-4">
            <Line title="HARI INI" b={d.today} base={st.base} />
            <Line title="7 HARI" b={d.week} base={st.base} />
            <Line title={`SIKLUS (${fmtDate(d.cyc.start)}–${fmtDate(d.cyc.end - 86_400_000)})`} b={d.cycle} base={st.base} />
          </div>
          {loading && <p className="nb-label mt-3 mb-0">MEMUAT…</p>}
          <div className="mt-4"><Plate><span className="text-sm font-bold">Sudah termasuk dalam total seluler.</span></Plate></div>
        </GradCard>

        {!loading && rows.length === 0 && (
          <Card tone="lilac">
            <p className="m-0 font-bold">Belum ada data hotspot.</p>
            <p className="mt-1 mb-0 text-sm leading-snug">
              Nyalakan hotspot dan pakai beberapa menit, lalu tekan segarkan. Data baru terbaca setelah sistem mencatatnya (bisa tertunda).
              Sebagian HP tidak mencatat tethering di statistik jaringan sama sekali. Kalau upstream hotspot-mu Wi-Fi (bukan data seluler), pemakaiannya juga mungkin tidak tercatat.
            </p>
            <Button className="mt-3 flex items-center gap-2" variant="ghost" onClick={reload}>
              <RefreshCw size={16} strokeWidth={2.5} aria-hidden />Segarkan
            </Button>
          </Card>
        )}

        {/* batas */}
        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Batas hotspot</h2>
          <div className="grid gap-4">
            <AmountField id="hs-day" label="BATAS HARIAN (0 = TANPA BATAS)" value={st.hotspot.daily}
              onChange={(daily) => updateSettings({ hotspot: { ...st.hotspot, daily } })} />
            {day && <ProgressBar percent={day.pct} label={`Hari ini: ${fmtBytes(day.used, st.base)} / ${fmtBytes(day.quota, st.base)}`} />}
            <AmountField id="hs-cyc" label="BATAS SIKLUS TAGIHAN (0 = TANPA BATAS)" value={st.hotspot.monthly}
              onChange={(monthly) => updateSettings({ hotspot: { ...st.hotspot, monthly } })} />
            {cyc && <ProgressBar percent={cyc.pct} label={`Siklus ini: ${fmtBytes(cyc.used, st.base)} / ${fmtBytes(cyc.quota, st.base)}`} />}
          </div>
          <p className="mb-0 mt-3 text-sm leading-snug">
            {st.alerts
              ? 'Notifikasi muncul saat pemakaian mencapai 80%, 90%, dan 100%. Tidak ada pemutusan otomatis.'
              : 'Notifikasi peringatan sedang dimatikan di Pengaturan, jadi batas ini hanya terlihat di halaman ini.'}
          </p>
        </Card>

        {/* grafik */}
        <Card>
          <div className="flex flex-wrap gap-2 mb-3">
            {(['jam', 'hari'] as const).map((m) => (
              <Button key={m} variant={mode === m ? 'primary' : 'ghost'} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'jam' ? 'Per jam (hari ini)' : 'Per hari (30 hari)'}
              </Button>
            ))}
          </div>
          <HotspotChart data={mode === 'jam' ? d.hourly : d.daily} base={st.base}
            label={(b) => mode === 'jam'
              ? `${String(new Date(b.t).getHours()).padStart(2, '0')}:00`
              : new Date(b.t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} />
        </Card>

        {/* hal yang jujur tidak bisa */}
        <Card tone="deep">
          <div className="flex items-center gap-2 mb-1"><Users size={20} strokeWidth={2.5} aria-hidden /><h2 className="m-0 text-lg font-bold">Perangkat terhubung</h2></div>
          <p className="m-0 mb-1 nb-label">TIDAK DIDUKUNG TANPA ROOT</p>
          <p className="m-0 text-sm leading-snug">
            Daftar perangkat yang tersambung dan pemakaian per perangkat berasal dari tabel ARP dan penghitung per klien milik sistem.
            Aplikasi biasa tidak boleh membacanya, jadi aplikasi ini tidak menampilkan angka palsu.
          </p>
        </Card>
        <Card tone="deep">
          <div className="flex items-center gap-2 mb-1"><Ban size={20} strokeWidth={2.5} aria-hidden /><h2 className="m-0 text-lg font-bold">Pembatasan kecepatan hotspot</h2></div>
          <p className="m-0 mb-1 nb-label">TIDAK DIDUKUNG TANPA ROOT</p>
          <p className="m-0 text-sm leading-snug">
            Trafik hotspot tidak melewati VPN lokal sebuah aplikasi, jadi tidak bisa dibatasi dari sini. Mode Lanjutan (root/Shizuku) yang bersifat eksperimental direncanakan di v0.6.
          </p>
        </Card>
      </div>
    </>
  );
}
