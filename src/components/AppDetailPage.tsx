import { useState, useMemo } from 'react';
import { ArrowLeft, ArrowDown, ArrowUp, ExternalLink, LayoutList } from 'lucide-react';
import { Header } from './Header';
import { AmountField, Card, Button, GradCard, ProgressBar } from './ui';
import { BarChart } from './Chart';
import { fmtBytes, addLocalDays, startOfLocalDay } from '../lib/usage';
import { useAppDetail, useForeground, appBucketSeries, useIconCache, type AppRow, type PeriodRange } from '../lib/appUsage';
import { BlockCard } from './BlockCard';
import { useNow } from '../lib/hooks';
import { findItem, useQuotaStatus } from '../lib/quotaStatus';
import { setAppLimit, useSettings, type Amount } from '../lib/settings';
import { Quota } from '../lib/quotaPlugin';

interface Props {
  row: AppRow;
  range: PeriodRange;
  onBack(): void;
}

export function AppDetailPage({ row, range, onBack }: Props) {
  const st    = useSettings();
  const icons = useIconCache();
  const icon  = icons.get(row.packageName);
  const [gran, setGran] = useState<'hour' | 'day'>('day');

  const now = useNow();
  const { hours, loading } = useAppDetail(row.uid, now);
  const fgSplit = useForeground(row.uid, range.from, range.to);
  const { status } = useQuotaStatus(hours);

  const chartData = useMemo(() => {
    const t0 = startOfLocalDay(now);
    return gran === 'hour'
      ? appBucketSeries(hours, t0, 24, 'hour')
      : appBucketSeries(hours, addLocalDays(t0, -29), 30, 'day');
  }, [hours, gran, now]);

  const lim = st.appLimits[row.packageName];
  const zero: Amount = { v: 0, u: 'GB' };
  const daily = lim?.daily ?? zero, monthly = lim?.monthly ?? zero;
  const dayItem = findItem(status, `app.${row.packageName}.day`);
  const cycItem = findItem(status, `app.${row.packageName}.cycle`);
  const fgTotal = fgSplit ? fgSplit.fg + fgSplit.bg : 0;

  const openAppInfo = () => Quota.openAppInfo({ packageName: row.packageName }).catch(() => {});

  return (
    <>
      <Header
        title=""
        left={
          <button onClick={onBack} aria-label="Kembali ke daftar"
            className="nb-box nb-press bg-surface text-ink px-3 py-2 flex items-center gap-2 font-bold">
            <ArrowLeft size={20} strokeWidth={2.5} aria-hidden />
            Kembali
          </button>
        }
      />
      <div className="p-4 grid gap-4">

        {/* identitas aplikasi */}
        <GradCard grad={4}>
          <div className="flex items-center gap-4">
            <div className="nb-box w-16 h-16 bg-pink grid place-items-center overflow-hidden shrink-0" style={{ '--sh': '4px' } as React.CSSProperties}>
              {icon
                ? <img src={icon} alt="" width={64} height={64} className="w-full h-full object-contain" aria-hidden />
                : <LayoutList size={32} strokeWidth={2.5} className="text-ink opacity-40" aria-hidden />}
            </div>
            <div className="text-paper min-w-0">
              <div className="font-bold text-xl leading-tight">{row.label}</div>
              <div className="nb-label text-xs opacity-70 truncate">{row.packageName}</div>
              {row.isSystem && <span className="nb-label text-xs bg-pink text-ink px-2 py-0.5 inline-block mt-1">SISTEM</span>}
            </div>
          </div>
        </GradCard>

        {/* total periode */}
        <Card>
          <p className="nb-label mb-2">TOTAL {range.label.toUpperCase()}</p>
          <div className="nb-num text-3xl mb-2">{fmtBytes(row.total, st.base)}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="nb-label text-xs opacity-60">UNDUHAN</div>
              <div className="nb-num flex items-center gap-1">
                <ArrowDown size={16} strokeWidth={3} aria-label="unduh" />
                {fmtBytes(row.rx, st.base)}
              </div>
            </div>
            <div>
              <div className="nb-label text-xs opacity-60">UNGGAHAN</div>
              <div className="nb-num flex items-center gap-1">
                <ArrowUp size={16} strokeWidth={3} aria-label="unggah" />
                {fmtBytes(row.tx, st.base)}
              </div>
            </div>
            <div>
              <div className="nb-label text-xs opacity-60">SELULER</div>
              <div className="nb-num">{fmtBytes(row.rxCell + row.txCell, st.base)}</div>
            </div>
            <div>
              <div className="nb-label text-xs opacity-60">WI-FI</div>
              <div className="nb-num">{fmtBytes(row.rxWifi + row.txWifi, st.base)}</div>
            </div>
          </div>
          {fgSplit && fgTotal > 0 ? (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="nb-label text-xs opacity-60">FOREGROUND</div>
                  <div className="nb-num">{fmtBytes(fgSplit.fg, st.base)} <span className="nb-label">{Math.round((fgSplit.fg / fgTotal) * 100)}%</span></div>
                </div>
                <div>
                  <div className="nb-label text-xs opacity-60">BACKGROUND</div>
                  <div className="nb-num">{fmtBytes(fgSplit.bg, st.base)} <span className="nb-label">{Math.round((fgSplit.bg / fgTotal) * 100)}%</span></div>
                </div>
              </div>
              <div className="nb-box h-4 mt-2 overflow-hidden flex" style={{ '--sh': '2px' } as React.CSSProperties} role="img"
                aria-label={`Foreground ${Math.round((fgSplit.fg / fgTotal) * 100)} persen, background ${Math.round((fgSplit.bg / fgTotal) * 100)} persen`}>
                <div style={{ width: `${(fgSplit.fg / fgTotal) * 100}%`, background: 'var(--royal)' }} />
                <div className="pat-wifi" style={{ flex: 1, background: 'var(--lilac)' }} />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs opacity-60">
              Rasio foreground vs background belum tersedia: butuh Android 9 ke atas, dan aplikasi ini harus punya pemakaian di periode ini.
            </p>
          )}
        </Card>

        {/* grafik */}
        <Card>
          <div className="flex flex-wrap gap-2 mb-3">
            {(['hour', 'day'] as const).map(g => (
              <Button key={g} variant={gran === g ? 'primary' : 'ghost'}
                aria-pressed={gran === g} onClick={() => setGran(g)}>
                {g === 'hour' ? 'Per jam (hari ini)' : 'Per hari (30 hari)'}
              </Button>
            ))}
          </div>
          {loading
            ? <p className="nb-label">MEMUAT…</p>
            : <BarChart
                data={chartData}
                net="semua"
                base={st.base}
                label={b => gran === 'hour'
                  ? `${String(new Date(b.t).getHours()).padStart(2, '0')}:00`
                  : new Date(b.t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
              />
          }
        </Card>

        {/* aksi */}
        <Button onClick={openAppInfo}
          aria-label={`Buka Info Aplikasi sistem untuk ${row.label}`}
          className="w-full flex items-center justify-center gap-2">
          <ExternalLink size={18} strokeWidth={2.5} aria-hidden />
          Buka Info Aplikasi Sistem
        </Button>

        <Card>
          <h2 className="m-0 mb-1 text-lg font-bold">Batas kuota aplikasi ini</h2>
          <p className="m-0 mb-3 text-sm opacity-80 leading-snug">Dihitung dari data seluler saja. Saat 80%, 90%, dan 100% tercapai kamu diberi notifikasi (aplikasi tidak diputus).</p>
          <div className="grid gap-4">
            <AmountField id="al-day" label="BATAS HARIAN (0 = TANPA BATAS)" value={daily}
              onChange={(a) => setAppLimit(row.packageName, row.label, a, monthly)} />
            {dayItem && <ProgressBar percent={dayItem.pct} label={`Hari ini: ${fmtBytes(dayItem.used, st.base)} / ${fmtBytes(dayItem.quota, st.base)}`} />}
            <AmountField id="al-cyc" label="BATAS SIKLUS TAGIHAN (0 = TANPA BATAS)" value={monthly}
              onChange={(a) => setAppLimit(row.packageName, row.label, daily, a)} />
            {cycItem && <ProgressBar percent={cycItem.pct} label={`Siklus ini: ${fmtBytes(cycItem.used, st.base)} / ${fmtBytes(cycItem.quota, st.base)}`} />}
          </div>
        </Card>

        <BlockCard row={row} />
      </div>
    </>
  );
}
