// PrankPage.tsx — WiFi Prank: satu tombol ON/OFF + live log client
// Capacitor 6 + React + TypeScript
// Komunikasi ke Kotlin: Prank.startPrank / stopPrank / getPrankState / events

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle, Clock, Copy, RefreshCw,
  Shield, ShieldOff, Skull, Users, Wifi, WifiOff, X,
} from 'lucide-react';
import { Header } from './Header';
import { Button, Card, GradCard, Plate, Toggle } from './ui';
import { Prank, type PrankClientInfo, type PrankConfig, type PrankState } from '../lib/quotaPlugin';

// ── config default ────────────────────────────────────────────────────────────

const LS_KEY = 'prank_cfg_v2';

const DEFAULT_CFG: PrankConfig = {
  pageTitle:     'WiFi Gratis',
  pageSubtitle:  'Tekan tombol di bawah untuk mulai memakai internet.',
  btnLabel:      'Masuk',
  connectingMsg: 'Menyambungkan internet...',
  theme:         'red',
};

const DEFAULT_FOTO = 'https://x.xcute.workers.dev/f/images/832d23289e7e.png';
const POLL_MS = 3_000;

function loadCfg(): PrankConfig {
  try { const r = localStorage.getItem(LS_KEY); if (r) return { ...DEFAULT_CFG, ...JSON.parse(r) }; }
  catch { /* */ }
  return { ...DEFAULT_CFG };
}
function saveCfg(c: PrankConfig) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* */ }
}

// ── helpers ───────────────────────────────────────────────────────────────────

const fmtTime = (ms: number) =>
  ms ? new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border-2 border-ink"
      style={{ background: on ? 'var(--royal)' : 'var(--surface)' }}
      aria-hidden
    />
  );
}

// ── halaman utama ─────────────────────────────────────────────────────────────

export function PrankPage() {
  const [cfg, setCfg]         = useState<PrankConfig>(loadCfg);
  const [fotoUrl, setFotoUrl] = useState(DEFAULT_FOTO);
  const [state, setState]     = useState<PrankState | null>(null);
  const [busy, setBusy]       = useState(false);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);
  const [log, setLog]         = useState<string[]>([]);
  const [err, setErr]         = useState<string | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const listenerRef           = useRef<{ remove: () => Promise<void> } | null>(null);
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [`[${fmtTime(Date.now())}] ${msg}`, ...prev].slice(0, 80));
  }, []);

  // polling state
  const poll = useCallback(async () => {
    try {
      const s = await Prank.getPrankState();
      setState(s);
    } catch { /* */ }
  }, []);

  // event listener: client connect / login
  useEffect(() => {
    let alive = true;
    Prank.addListener('prankClient', (c: PrankClientInfo) => {
      if (!alive) return;
      if (c.loggedIn) {
        addLog(`✓ LOGIN — ${c.ip}`);
      } else {
        addLog(`⟶ CONNECT — ${c.ip}`);
      }
      setState((prev) => {
        if (!prev) return prev;
        const clients = [...prev.clients.filter((x) => x.ip !== c.ip), c];
        return { ...prev, clients };
      });
    }).then((h) => { if (alive) listenerRef.current = h; }).catch(() => {});

    return () => {
      alive = false;
      listenerRef.current?.remove().catch(() => {});
    };
  }, [addLog]);

  // poll saat running
  useEffect(() => {
    poll();
    pollRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [poll]);

  // simpan config ke localStorage
  useEffect(() => { saveCfg(cfg); }, [cfg]);

  const running = state?.running ?? false;

  // ── toggle ON / OFF ────────────────────────────────────────────────────────

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (running) {
        addLog('Menghentikan prank...');
        await Prank.stopPrank();
        addLog('Prank dimatikan.');
        setAccessUrl(null);
        setState((prev) => prev ? { ...prev, running: false, clients: [] } : prev);
      } else {
        addLog('Memulai prank...');
        const r = await Prank.startPrank({ config: cfg, fotoUrl });
        if (r.ok) {
          const url = (r as any).accessUrl ?? `http://${r.gatewayIp}:8787/`;
          setAccessUrl(url);
          addLog(`Prank aktif — ${url}`);
        } else {
          setErr(r.message ?? 'Gagal');
          addLog(`✗ ${r.message ?? 'Gagal'}`);
        }
      }
      await poll();
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      setErr(msg);
      addLog(`✗ Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  // ── unblock / block manual ─────────────────────────────────────────────────

  async function unblock(ip: string) {
    try {
      await Prank.unblockClient({ ip });
      addLog(`Unblock manual: ${ip}`);
      await poll();
    } catch (e: unknown) { addLog(`Unblock gagal: ${(e as Error)?.message}`); }
  }

  async function block(ip: string) {
    try {
      await Prank.blockClient({ ip });
      addLog(`Block manual: ${ip}`);
      await poll();
    } catch (e: unknown) { addLog(`Block gagal: ${(e as Error)?.message}`); }
  }

  const clients = state?.clients ?? [];

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Header title="WiFi Prank" />
      <div className="p-4 grid gap-4">

        {/* ── tombol ON/OFF utama ── */}
        <GradCard grad={running ? 1 : 4}>
          <div className="flex items-center gap-3 mb-4">
            <Skull size={28} strokeWidth={2.5} aria-hidden />
            <div>
              <h2 className="m-0 text-xl font-bold">WiFi Prank</h2>
              <p className="m-0 text-sm opacity-80">
                {running
                  ? `Aktif · gateway ${state?.gatewayIp}`
                  : 'Hotspot palsu + halaman login kejutan'}
              </p>
            </div>
            <StatusDot on={running} />
          </div>

          <button
            onClick={toggle}
            disabled={busy}
            aria-busy={busy}
            className={[
              'nb-box nb-press w-full py-5 font-bold text-xl flex items-center justify-center gap-3',
              running ? 'bg-alert text-paper' : 'bg-royal text-paper',
              busy ? 'opacity-60' : '',
            ].join(' ')}
          >
            {busy ? (
              <RefreshCw size={24} strokeWidth={2.5} className="animate-spin" aria-hidden />
            ) : running ? (
              <WifiOff size={24} strokeWidth={2.5} aria-hidden />
            ) : (
              <Wifi size={24} strokeWidth={2.5} aria-hidden />
            )}
            {busy ? 'Memproses...' : running ? 'MATIKAN PRANK' : 'NYALAKAN PRANK'}
          </button>

          {err && (
            <div className="mt-3 flex items-start gap-2">
              <AlertTriangle size={16} strokeWidth={2.5} className="shrink-0 mt-0.5" aria-hidden />
              <p className="m-0 text-sm font-bold">{err}</p>
            </div>
          )}
        </GradCard>

        {/* ── URL share (muncul kalau tidak ada iptables) ── */}
        {running && accessUrl && accessUrl.includes(':8787') && (
          <Card>
            <div className="flex items-center gap-2 mb-2">
              <Wifi size={18} strokeWidth={2.5} aria-hidden />
              <h2 className="m-0 text-base font-bold">URL untuk korban</h2>
            </div>
            <p className="m-0 mb-3 text-sm opacity-80">
              HP tidak root — redirect otomatis tidak aktif. Bagikan URL ini ke korban
              setelah mereka connect ke hotspot.
            </p>
            <div
              className="nb-box bg-deep text-paper px-3 py-3 mb-3 select-all"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', wordBreak: 'break-all' }}
            >
              {accessUrl}
            </div>
            <Button
              className="w-full flex items-center justify-center gap-2"
              onClick={() => {
                navigator.clipboard.writeText(accessUrl).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }).catch(() => {});
              }}
            >
              <Copy size={16} strokeWidth={2.5} aria-hidden />
              {copied ? 'Tersalin!' : 'Copy URL'}
            </Button>
          </Card>
        )}

        {/* ── client list ── */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Users size={20} strokeWidth={2.5} aria-hidden />
            <h2 className="m-0 text-lg font-bold">
              Perangkat ({clients.length})
            </h2>
            <button
              onClick={poll}
              aria-label="Segarkan"
              className="ml-auto nb-box nb-press bg-surface text-text px-2 py-1"
            >
              <RefreshCw size={14} strokeWidth={2.5} aria-hidden />
            </button>
          </div>

          {clients.length === 0 ? (
            <p className="m-0 text-sm opacity-70">
              {running ? 'Belum ada perangkat yang connect.' : 'Prank belum aktif.'}
            </p>
          ) : (
            <ul className="m-0 p-0 list-none grid gap-2">
              {clients.map((c) => (
                <li key={c.ip} className="nb-box bg-surface p-3 grid gap-1">
                  <div className="flex items-center gap-2 justify-between">
                    <span className="font-bold font-mono text-sm">{c.ip}</span>
                    <span className={`nb-label text-xs font-bold ${c.loggedIn ? 'text-royal' : ''}`}>
                      {c.loggedIn ? '✓ LOGIN' : 'belum login'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-60 text-xs">
                    <Clock size={11} aria-hidden />
                    {fmtTime(c.connectedAt)}
                    {c.loggedIn && <> · login {fmtTime(c.loginAt)}</>}
                  </div>
                  <div className="flex gap-2 mt-1">
                    {c.loggedIn ? (
                      <Button
                        variant="ghost"
                        className="flex items-center gap-1 text-sm py-1 px-2"
                        onClick={() => block(c.ip)}
                      >
                        <ShieldOff size={14} strokeWidth={2.5} aria-hidden />
                        Reset sesi
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="flex items-center gap-1 text-sm py-1 px-2"
                        onClick={() => unblock(c.ip)}
                      >
                        <Shield size={14} strokeWidth={2.5} aria-hidden />
                        Unblock manual
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── log terminal ── */}
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="m-0 text-base font-bold">Log</h2>
            <button
              onClick={() => setLog([])}
              aria-label="Bersihkan log"
              className="ml-auto nb-box nb-press bg-surface text-text px-2 py-1 flex items-center gap-1 text-xs font-bold"
            >
              <X size={12} strokeWidth={2.5} aria-hidden /> Bersihkan
            </button>
          </div>
          <div
            className="nb-box bg-deep text-paper p-3 overflow-y-auto"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', maxHeight: '200px' }}
          >
            {log.length === 0
              ? <span className="opacity-40">— belum ada log —</span>
              : log.map((l, i) => <div key={i}>{l}</div>)
            }
          </div>
        </Card>

        {/* ── konfigurasi (lipat) ── */}
        <Card>
          <Toggle
            checked={showCfg}
            onChange={setShowCfg}
            label="Konfigurasi halaman prank"
            hint="Teks, foto, dan tema warna"
          />
          {showCfg && (
            <div className="mt-4 grid gap-3">
              <CfgField label="URL FOTO KEJUTAN" value={fotoUrl}
                onChange={setFotoUrl} mono />
              {fotoUrl && (
                <img
                  src={fotoUrl}
                  alt="Preview foto"
                  className="nb-box w-full max-h-36 object-contain bg-surface"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <CfgField label="JUDUL" value={cfg.pageTitle}
                onChange={(v) => setCfg((p) => ({ ...p, pageTitle: v }))} />
              <CfgField label="KETERANGAN" value={cfg.pageSubtitle}
                onChange={(v) => setCfg((p) => ({ ...p, pageSubtitle: v }))} />
              <CfgField label="TEKS TOMBOL" value={cfg.btnLabel}
                onChange={(v) => setCfg((p) => ({ ...p, btnLabel: v }))} />
              <CfgField label="PESAN LOADING" value={cfg.connectingMsg}
                onChange={(v) => setCfg((p) => ({ ...p, connectingMsg: v }))} />
              <div>
                <span className="nb-label block mb-1">TEMA WARNA</span>
                <div className="flex gap-2 flex-wrap">
                  {(['red','black','blue'] as const).map((t) => (
                    <Button
                      key={t}
                      variant={cfg.theme === t ? 'primary' : 'ghost'}
                      aria-pressed={cfg.theme === t}
                      onClick={() => setCfg((p) => ({ ...p, theme: t }))}
                    >
                      {{ red:'Merah', black:'Hitam', blue:'Biru' }[t]}
                    </Button>
                  ))}
                </div>
              </div>

              {running && (
                <Button
                  variant="ghost"
                  className="w-full flex items-center justify-center gap-2"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await Prank.updateFoto({ fotoUrl });
                      addLog('Foto diperbarui.');
                    } catch (e: unknown) {
                      addLog(`Update foto gagal: ${(e as Error)?.message}`);
                    } finally { setBusy(false); }
                  }}
                >
                  <RefreshCw size={16} strokeWidth={2.5} aria-hidden />
                  Update foto (prank sedang jalan)
                </Button>
              )}

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => { setCfg({ ...DEFAULT_CFG }); setFotoUrl(DEFAULT_FOTO); }}
              >
                Reset ke default
              </Button>
            </div>
          )}
        </Card>

        {/* ── catatan syarat ── */}
        <Card tone="deep">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} strokeWidth={2.5} aria-hidden />
            <h2 className="m-0 text-sm font-bold">Syarat</h2>
          </div>
          <ul className="m-0 pl-4 text-sm leading-relaxed opacity-80">
            <li>Shizuku harus berjalan dan izin sudah diberikan</li>
            <li>HP harus di-root (iptables butuh root)</li>
            <li>Android 11+ untuk kontrol hotspot via Shizuku</li>
            <li>WiFi hotspot belum aktif sebelumnya</li>
          </ul>
        </Card>

      </div>
    </>
  );
}

function CfgField({ label, value, onChange, mono = false }:
  { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <label className="nb-label block mb-1">{label}</label>
      <input
        className="nb-box bg-surface text-text px-3 min-h-12 w-full font-bold"
        style={mono ? { fontFamily: 'var(--font-mono)', fontSize: '0.85em' } : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
