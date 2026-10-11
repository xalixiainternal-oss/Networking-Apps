import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, SlidersHorizontal, RefreshCw, ArrowDown, ArrowUp, LayoutList, X, Info } from 'lucide-react';
import { Header } from './Header';
import { Card, Button } from './ui';
import { fmtBytes, startOfLocalDay, addLocalDays } from '../lib/usage';
import { describeRule } from '../lib/blocking';
import { useApps, periodRange, loadIcon, useIconCache, unattributed, type Period, type SortKey, type NetFilter, type AppRow } from '../lib/appUsage';
import { useSettings } from '../lib/settings';
import { AppDetailPage } from './AppDetailPage';
import { PageTransition } from './PageTransition';

// ── Baris satu aplikasi ────────────────────────────────────────────────────
function AppRowItem({ row, base, onClick }: { row: AppRow; base: 1000 | 1024; onClick(): void }) {
  const icons = useIconCache();
  const icon  = icons.get(row.packageName);
  const cfg   = useSettings();
  const rule  = cfg.blockOn ? cfg.blockRules[row.packageName] : undefined;

  // muat ikon saat masuk viewport
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { loadIcon(row.packageName); obs.disconnect(); }
    }, { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [row.packageName]);

  return (
    <button ref={ref} onClick={onClick}
      className="nb-box nb-press nb-row bg-surface text-text w-full text-left p-3 flex items-center gap-3"
      aria-label={`${row.label}, total ${fmtBytes(row.total, base)}`}>
      {/* ikon */}
      <div className="w-11 h-11 nb-box shrink-0 bg-pink grid place-items-center overflow-hidden" style={{ '--sh': '3px' } as React.CSSProperties}>
        {icon ? (
          <img src={icon} alt="" width={44} height={44} className="w-full h-full object-contain" aria-hidden />
        ) : (
          <LayoutList size={22} strokeWidth={2.5} aria-hidden className="text-ink opacity-40" />
        )}
      </div>
      {/* info utama */}
      <div className="flex-1 min-w-0">
        <div className="font-bold truncate">{row.label}</div>
        <div className="nb-label truncate text-xs opacity-60">{row.packageName}</div>
        <div className="mt-1 flex items-center gap-3">
          <span className="nb-num text-sm flex items-center gap-1">
            <ArrowDown size={13} strokeWidth={3} aria-label="unduh" />{fmtBytes(row.rx, base)}
          </span>
          <span className="nb-num text-sm flex items-center gap-1">
            <ArrowUp size={13} strokeWidth={3} aria-label="unggah" />{fmtBytes(row.tx, base)}
          </span>
        </div>
      </div>
      {/* total + persen */}
      <div className="shrink-0 text-right">
        <div className="nb-num font-bold">{fmtBytes(row.total, base)}</div>
        <div className="nb-label text-xs">{row.pct.toFixed(1)}%</div>
        {row.isSystem && <span className="nb-label text-xs opacity-50">SISTEM</span>}
        {rule && <span className="nb-label text-xs bg-pink text-ink px-1.5 py-0.5 inline-block">BLOKIR: {describeRule(rule)}</span>}
      </div>
    </button>
  );
}

// ── Panel filter ────────────────────────────────────────────────────────────
const PERIODS: { id: Period; label: string }[] = [
  { id: 'hari-ini', label: 'Hari ini' },
  { id: 'kemarin',  label: 'Kemarin'  },
  { id: '7-hari',   label: '7 hari'   },
  { id: '30-hari',  label: '30 hari'  },
  { id: 'siklus',   label: 'Siklus'   },
  { id: 'kustom',   label: 'Kustom'   },
];

const PAGE = 40;
const toInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromInput = (v: string) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

const NETS: { id: NetFilter; label: string }[] = [
  { id: 'semua', label: 'Semua'    },
  { id: 'cell',  label: 'Seluler'  },
  { id: 'wifi',  label: 'Wi-Fi'    },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'total', label: 'Terbesar'  },
  { id: 'rx',    label: 'Unduh'     },
  { id: 'tx',    label: 'Unggah'    },
  { id: 'label', label: 'Nama A-Z'  },
];

// ── Halaman utama ──────────────────────────────────────────────────────────
export function AppsPage() {
  const st = useSettings();
  const [period, setPeriod]         = useState<Period>('7-hari');
  const [net, setNet]               = useState<NetFilter>('semua');
  const [sort, setSort]             = useState<SortKey>('total');
  const [query, setQuery]           = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail]         = useState<AppRow | null>(null);
  const [cFrom, setCFrom]           = useState(() => addLocalDays(startOfLocalDay(Date.now()), -6));
  const [cTo, setCTo]               = useState(() => startOfLocalDay(Date.now()));
  const [shown, setShown]           = useState(PAGE);

  const range = useMemo(() => periodRange(period, st.resetDay, Date.now(), cFrom, cTo), [period, st.resetDay, cFrom, cTo]);
  const { rows, deviceTotal, tetherTotal, loading, syncing, syncInfo, reload } = useApps(range, net, sort);

  const filtered = useMemo(() => {
    let r = rows;
    if (!showSystem) r = r.filter(a => !a.isSystem);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(a => a.label.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q));
    }
    return r;
  }, [rows, showSystem, query]);

  const grandTotal = useMemo(() => filtered.reduce((a, r) => a + r.total, 0), [filtered]);
  const appsTotal  = useMemo(() => rows.reduce((a, r) => a + r.total, 0), [rows]);

  // Render bertahap: 300+ aplikasi tidak dibuat sekaligus. Sentinel di dasar daftar memuat 40 berikutnya.
  useEffect(() => { setShown(PAGE); }, [period, net, sort, query, showSystem, cFrom, cTo]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(es => { if (es[0].isIntersecting) setShown(n => n + PAGE); }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length, shown]);

  if (detail) return (
    <PageTransition pageKey="detail">
      <AppDetailPage row={detail} range={range} onBack={() => setDetail(null)} />
    </PageTransition>
  );

  return (
    <PageTransition pageKey="list">
      <Header title="Aplikasi" />
      <div className="p-4 grid gap-3">

        {/* info sync */}
        {syncInfo && !syncInfo.ok && (
          <Card tone="pink">
            <div className="flex gap-2 items-start">
              <Info size={18} strokeWidth={2.5} className="shrink-0 mt-0.5" aria-hidden />
              <span className="text-sm">{syncInfo.message ?? 'Gagal sinkronisasi.'}</span>
            </div>
          </Card>
        )}

        {/* bar pencarian + aksi */}
        <div className="flex gap-2">
          <div className="nb-box flex-1 flex items-center gap-2 px-3 py-2 bg-surface text-text">
            <Search size={18} strokeWidth={2.5} aria-hidden />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Cari aplikasi…"
              aria-label="Cari aplikasi"
              className="flex-1 bg-transparent outline-none font-sans text-base placeholder:opacity-40"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Hapus pencarian">
                <X size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <Button variant={filterOpen ? 'primary' : 'ghost'}
            aria-label="Buka filter" aria-expanded={filterOpen}
            onClick={() => setFilterOpen(v => !v)}>
            <SlidersHorizontal size={20} strokeWidth={2.5} aria-hidden />
          </Button>
          <Button variant="ghost" aria-label="Segarkan" onClick={reload} disabled={syncing}>
            <RefreshCw size={20} strokeWidth={2.5} aria-hidden className={syncing ? 'animate-spin' : ''} />
          </Button>
        </div>

        {/* panel filter */}
        {filterOpen && (
          <Card>
            <div className="grid gap-3">
              <div>
                <p className="nb-label mb-1">PERIODE</p>
                <div className="flex flex-wrap gap-2">
                  {PERIODS.map(p => (
                    <Button key={p.id} variant={period === p.id ? 'primary' : 'ghost'}
                      aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              {period === 'kustom' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1"><span className="nb-label">DARI</span>
                    <input type="date" className="nb-box bg-surface text-text px-3 min-h-12 font-bold" value={toInput(cFrom)} max={toInput(cTo)}
                      onChange={e => e.target.value && setCFrom(fromInput(e.target.value))} /></label>
                  <label className="grid gap-1"><span className="nb-label">SAMPAI</span>
                    <input type="date" className="nb-box bg-surface text-text px-3 min-h-12 font-bold" value={toInput(cTo)} min={toInput(cFrom)} max={toInput(Date.now())}
                      onChange={e => e.target.value && setCTo(fromInput(e.target.value))} /></label>
                </div>
              )}
              <div>
                <p className="nb-label mb-1">JARINGAN</p>
                <div className="flex flex-wrap gap-2">
                  {NETS.map(n => (
                    <Button key={n.id} variant={net === n.id ? 'pink' : 'ghost'}
                      aria-pressed={net === n.id} onClick={() => setNet(n.id)}>
                      {n.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <p className="nb-label mb-1">URUT</p>
                <div className="flex flex-wrap gap-2">
                  {SORTS.map(s => (
                    <Button key={s.id} variant={sort === s.id ? 'lilac' : 'ghost'}
                      aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={showSystem} onChange={e => setShowSystem(e.target.checked)}
                  className="w-5 h-5" />
                <span className="font-semibold">Tampilkan aplikasi sistem</span>
              </label>
            </div>
          </Card>
        )}

        {/* ringkasan */}
        <div className="nb-box grad-4 p-3 text-paper flex items-center justify-between">
          <div>
            <div className="nb-label text-xs opacity-70">TOTAL {range.label.toUpperCase()}</div>
            <div className="nb-num text-xl">{fmtBytes(grandTotal, st.base)}</div>
          </div>
          <div className="text-right">
            <div className="nb-label text-xs opacity-70">APLIKASI DITAMPILKAN</div>
            <div className="nb-num text-xl">{loading ? '…' : filtered.length}</div>
          </div>
        </div>

        {/* daftar */}
        {loading ? (
          <Card><p className="nb-label">MEMUAT…</p></Card>
        ) : filtered.length === 0 ? (
          <Card>
            <p className="m-0">Tidak ada data untuk periode ini.</p>
            {!showSystem && <p className="mt-2 text-sm opacity-70">Coba aktifkan "Tampilkan aplikasi sistem" di filter.</p>}
          </Card>
        ) : (
          <div className="grid gap-2">
            {filtered.slice(0, shown).map(row => (
              <AppRowItem key={`${row.uid}-${row.packageName}`} row={row} base={st.base} onClick={() => setDetail(row)} />
            ))}
            {shown < filtered.length && <div ref={sentinel} className="nb-label text-center p-3">MEMUAT LEBIH BANYAK…</div>}

            {/* selisih terhadap total sistem */}
            <SystemDelta deviceTotal={deviceTotal} appsTotal={appsTotal} tetherTotal={tetherTotal} base={st.base} />
          </div>
        )}
      </div>
    </PageTransition>
  );
}

// ── Selisih total sistem vs jumlah per aplikasi ──────────────────────────────
function SystemDelta({ deviceTotal, appsTotal, tetherTotal, base }:
  { deviceTotal: number; appsTotal: number; tetherTotal: number; base: 1000 | 1024 }) {
  const rest = unattributed(deviceTotal, appsTotal, tetherTotal);
  if (deviceTotal <= 0) return null;
  return (
    <Card tone="lilac">
      <p className="m-0 text-sm"><b>Total sistem:</b> {fmtBytes(deviceTotal, base)}</p>
      <p className="m-0 text-sm"><b>Jumlah semua aplikasi:</b> {fmtBytes(appsTotal, base)}</p>
      {tetherTotal > 0 && <p className="m-0 text-sm"><b>Hotspot (tethering):</b> {fmtBytes(tetherTotal, base)}</p>}
      <p className="m-0 mt-1 text-sm"><b>Lainnya / sistem:</b> {fmtBytes(rest, base)}</p>
      <p className="mb-0 mt-1 opacity-80 text-xs">Selisih berasal dari aplikasi yang sudah dihapus, proses sistem, pembulatan bucket, dan data yang dicatat dengan cara berbeda oleh kernel. Sedikit selisih itu wajar.</p>
    </Card>
  );
}
