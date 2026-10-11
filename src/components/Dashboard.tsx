import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Gauge, Info, Radio, TrendingUp } from 'lucide-react';
import { Card, GradCard, ProgressBar, Button } from './ui';
import { Header } from './Header';
import { BarChart, type NetFilter } from './Chart';
import { useHours, useNow, useSpeed } from '../lib/hooks';
import { sumTether, useTether } from '../lib/hotspot';
import { useQuotaStatus, findItem } from '../lib/quotaStatus';
import { Quota } from '../lib/quotaPlugin';
import { useIconCache, loadIcon, ensureAppSync } from '../lib/appUsage';
import { useSettings } from '../lib/settings';
import {
  DAY, HOUR, addLocalDays, bucketSeries, cycleRange,
  fmtBytes, fmtSpeed, forecast, splitByNet, startOfLocalDay, type Bytes,
} from '../lib/usage';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });

function Row({ title, cell, wifi, hot, base }: { title: string; cell: Bytes; wifi: Bytes; hot: Bytes; base: 1000 | 1024 }) {
  const Line = ({ name, b, icon }: { name: string; b: Bytes; icon?: boolean }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="nb-label w-24 flex items-center gap-1">{icon && <Radio size={12} strokeWidth={3} aria-hidden />}{name}</span>
      <span className="nb-num flex items-center gap-1"><ArrowDown size={14} strokeWidth={3} aria-label="unduh" />{fmtBytes(b.rx, base)}</span>
      <span className="nb-num flex items-center gap-1"><ArrowUp size={14} strokeWidth={3} aria-label="unggah" />{fmtBytes(b.tx, base)}</span>
    </div>
  );
  return (
    <div className="grid gap-1">
      <div className="nb-num text-2xl">{fmtBytes(cell.rx + cell.tx + wifi.rx + wifi.tx, base)} <span className="nb-label">{title}</span></div>
      <Line name="SELULER" b={cell} /><Line name="WI-FI" b={wifi} />
      <Line name="HOTSPOT" b={hot} icon />
    </div>
  );
}

interface DashboardProps {
  /** Dipanggil saat pengguna mengetuk "Lihat semua" di Top-5, supaya berpindah ke tab Aplikasi. */
  onGoToApps?(): void;
}

export function Dashboard({ onGoToApps }: DashboardProps) {
  const st                              = useSettings();
  const { rows, info, loading, reload } = useHours();
  const { rows: tether }                = useTether();
  const { speed, error }                = useSpeed();
  const { status }                      = useQuotaStatus(rows);
  const now                             = useNow();
  const [mode, setMode]                 = useState<'jam' | 'hari'>('jam');
  const [net, setNet]                   = useState<NetFilter>('semua');

  const d = useMemo(() => {
    const t0 = startOfLocalDay(now), tEnd = now + HOUR, cyc = cycleRange(now, st.resetDay);
    return {
      cyc,
      today: splitByNet(rows, t0, tEnd),
      week:  splitByNet(rows, addLocalDays(t0, -6), tEnd),
      cycle: splitByNet(rows, cyc.start, cyc.end),
      hotToday: sumTether(tether, t0, tEnd),
      hotWeek:  sumTether(tether, addLocalDays(t0, -6), tEnd),
      hotCycle: sumTether(tether, cyc.start, cyc.end),
      hourly: bucketSeries(rows, t0, 24, 'hour'),
      daily:  bucketSeries(rows, addLocalDays(t0, -29), 30, 'day'),
    };
  }, [rows, tether, st.resetDay, now]);

  // Angka kuota datang dari Kotlin (sudah memperhitungkan kuota malam & Wi-Fi), sama dengan yang dipakai notifikasi.
  const main  = findItem(status, 'cell');
  const night = findItem(status, 'night');
  const wifiQ = findItem(status, 'wifi');
  const fc    = main ? forecast(main.used, main.quota, main.periodStart, main.periodEnd, now) : null;
  const anyQuota = Boolean(main || night || wifiQ);

  return (
    <>
      <Header title="Dashboard" />
      <div className="p-4 grid gap-4">

        {info && !info.ok && (
          <Card tone="pink">
            <div className="flex gap-2"><Info size={20} strokeWidth={2.5} aria-hidden className="shrink-0" /><span>{info.message ?? 'Data belum bisa dibaca.'}</span></div>
            <Button className="mt-3" variant="ghost" onClick={reload}>Coba lagi</Button>
          </Card>
        )}
        {info?.ok && !info.mobileSupported && (
          <Card tone="pink"><b>Android 8–9:</b> data seluler tidak bisa dibaca tanpa izin telepon. Hanya Wi-Fi yang dicatat.</Card>
        )}

        {/* kartu total */}
        <GradCard>
          <div className="grid gap-4">
            <Row title="HARI INI" cell={d.today.cell} wifi={d.today.wifi} hot={d.hotToday} base={st.base} />
            <Row title="7 HARI"   cell={d.week.cell}  wifi={d.week.wifi}  hot={d.hotWeek}  base={st.base} />
            <Row title={`SIKLUS (${fmtDate(d.cyc.start)}–${fmtDate(d.cyc.end - DAY)})`} cell={d.cycle.cell} wifi={d.cycle.wifi} hot={d.hotCycle} base={st.base} />
          </div>
          <p className="nb-label mt-3 mb-0">HOTSPOT SUDAH TERMASUK DALAM SELULER</p>
          {loading && <p className="nb-label mt-1 mb-0">MEMUAT…</p>}
        </GradCard>

        {/* kecepatan real-time */}
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <Gauge size={22} strokeWidth={2.5} aria-hidden /><h2 className="m-0 text-lg font-bold">Kecepatan sekarang</h2>
          </div>
          {speed ? (
            <div className="nb-num text-xl flex gap-6">
              <span className="flex items-center gap-1"><ArrowDown size={18} strokeWidth={3} aria-label="unduh" />{fmtSpeed(speed.down, st.base)}</span>
              <span className="flex items-center gap-1"><ArrowUp size={18} strokeWidth={3} aria-label="unggah" />{fmtSpeed(speed.up, st.base)}</span>
            </div>
          ) : <p className="m-0">{error ?? 'Mengukur…'}</p>}
          <p className="nb-label mt-2 mb-0">TOTAL SELULER + WI-FI, DIUKUR TIAP 1 DETIK SAAT LAYAR AKTIF</p>
        </Card>

        {/* sisa kuota */}
        <Card>
          <h2 className="m-0 mb-3 text-lg font-bold">Sisa kuota</h2>
          {anyQuota ? (
            <div className="grid gap-4">
              {main && (
                <div className="grid gap-2">
                  <ProgressBar percent={main.pct} label={`Seluler ${fmtBytes(main.used, st.base)} / ${fmtBytes(main.quota, st.base)}`} />
                  <p className="m-0 nb-num">SISA {fmtBytes(Math.max(0, main.quota - main.used), st.base)}</p>
                  <p className="m-0">
                    {fc?.kind === 'habis'   && 'Kuota sudah habis untuk siklus ini.'}
                    {fc?.kind === 'aman'    && 'Dengan laju sekarang, kuota cukup sampai siklus berakhir.'}
                    {fc?.kind === 'tanggal' && `Perkiraan habis sekitar ${fmtDate(fc.at)} (dari rata-rata harian siklus ini).`}
                    {fc?.kind === 'belum'   && 'Belum cukup data untuk memperkirakan.'}
                  </p>
                </div>
              )}
              {night && (
                <ProgressBar percent={night.pct}
                  label={`Malam ${String(st.night.startHour).padStart(2, '0')}:00–${String(st.night.endHour).padStart(2, '0')}:00 · ${fmtBytes(night.used, st.base)} / ${fmtBytes(night.quota, st.base)}`} />
              )}
              {wifiQ && <ProgressBar percent={wifiQ.pct} label={`Wi-Fi ${fmtBytes(wifiQ.used, st.base)} / ${fmtBytes(wifiQ.quota, st.base)}`} />}
            </div>
          ) : <p className="m-0">Isi total kuota di Pengaturan untuk melihat sisa dan perkiraan habis.</p>}
        </Card>

        {/* top-5 boros */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={20} strokeWidth={2.5} aria-hidden />
              <h2 className="m-0 text-lg font-bold">Top 5 Paling Boros</h2>
            </div>
            {onGoToApps && <Button variant="ghost" onClick={onGoToApps} aria-label="Lihat semua aplikasi">Lihat semua</Button>}
          </div>
          <Top5 base={st.base} onGoToApps={onGoToApps} />
        </Card>

        {/* grafik */}
        <Card>
          <div className="flex flex-wrap gap-2 mb-3">
            {(['jam', 'hari'] as const).map(m => (
              <Button key={m} variant={mode === m ? 'primary' : 'ghost'} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'jam' ? 'Per jam (hari ini)' : 'Per hari (30 hari)'}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {([['semua', 'Semua'], ['cell', 'Seluler'], ['wifi', 'Wi-Fi']] as const).map(([k, l]) => (
              <Button key={k} variant={net === k ? 'pink' : 'ghost'} aria-pressed={net === k} onClick={() => setNet(k)}>{l}</Button>
            ))}
          </div>
          <BarChart
            data={mode === 'jam' ? d.hourly : d.daily}
            net={net} base={st.base}
            label={b => mode === 'jam'
              ? `${String(new Date(b.t).getHours()).padStart(2, '0')}:00`
              : new Date(b.t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
          />
        </Card>
      </div>
    </>
  );
}

// ── Top-5 (7 hari terakhir) ───────────────────────────────────────────────────
function Top5({ base, onGoToApps }: { base: 1000 | 1024; onGoToApps?(): void }) {
  const [items, setItems] = useState<{ label: string; pkg: string; total: number }[] | null>(null);
  const icons = useIconCache();

  useEffect(() => {
    let alive = true;
    (async () => {
      try { await ensureAppSync(); } catch { /* tetap tampilkan data yang sudah ada */ }
      const now = Date.now();
      const [sum, info] = await Promise.all([
        Quota.getAppSummary({ from: addLocalDays(startOfLocalDay(now), -6), to: now + HOUR }),
        Quota.getAppInfoList(),
      ]);
      if (!alive) return;
      const map = new Map(info.rows.map(i => [i.uid, i]));
      const top = sum.rows
        .map(s => ({ label: map.get(s.uid)?.label ?? `UID ${s.uid}`, pkg: map.get(s.uid)?.packageName ?? '', total: s.rx + s.tx }))
        .filter(r => r.pkg && r.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
      setItems(top);
      top.forEach(r => loadIcon(r.pkg));
    })().catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  if (items === null) return <p className="m-0 nb-label">MEMUAT…</p>;
  if (items.length === 0) return <p className="m-0 text-sm">Belum ada data per-aplikasi. Pastikan Akses Penggunaan aktif, lalu buka tab Aplikasi.</p>;

  return (
    <div className="grid gap-2">
      <p className="m-0 nb-label">7 HARI TERAKHIR</p>
      {items.map((item, i) => {
        const icon = icons.get(item.pkg);
        return (
          <button key={item.pkg} onClick={onGoToApps}
            className="nb-box nb-press bg-surface text-text flex items-center gap-3 p-2 w-full text-left"
            aria-label={`${i + 1}. ${item.label}, ${fmtBytes(item.total, base)}`}>
            <span className="nb-num w-5 text-center shrink-0">{i + 1}</span>
            <div className="w-8 h-8 nb-box shrink-0 bg-pink grid place-items-center overflow-hidden" style={{ '--sh': '2px' } as React.CSSProperties}>
              {icon
                ? <img src={icon} alt="" width={32} height={32} className="w-full h-full object-contain" aria-hidden />
                : <span className="nb-label text-xs">{item.label.slice(0, 2).toUpperCase()}</span>}
            </div>
            <span className="flex-1 font-semibold truncate">{item.label}</span>
            <span className="nb-num shrink-0">{fmtBytes(item.total, base)}</span>
          </button>
        );
      })}
    </div>
  );
}
