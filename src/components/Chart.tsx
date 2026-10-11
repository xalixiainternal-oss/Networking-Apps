import type { Bucket } from '../lib/usage';
import type { HotBucket } from '../lib/hotspot';
import { fmtBytes } from '../lib/usage';
import { Smartphone, Wifi, Radio } from 'lucide-react';

export type NetFilter = 'semua' | 'cell' | 'wifi';

/** Batang bertumpuk. Seluler = royal polos, Wi-Fi = lilac bergaris. Label & ikon di legenda (tidak bergantung warna saja). */
export function BarChart({ data, net, base, label }: { data: Bucket[]; net: NetFilter; base: 1000 | 1024; label: (b: Bucket, i: number) => string }) {
  const val = (b: Bucket) => ({ c: net === 'wifi' ? 0 : b.cell, w: net === 'cell' ? 0 : b.wifi });
  const max = Math.max(1, ...data.map((b) => { const v = val(b); return v.c + v.w; }));
  const W = 320, H = 130, bw = W / data.length;
  const total = data.reduce((a, b) => a + val(b).c + val(b).w, 0);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img"
        aria-label={`Grafik pemakaian, total ${fmtBytes(total, base)}`}>
        <defs>
          <pattern id="pw" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" style={{ fill: 'var(--lilac)' }} />
            <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2.5" style={{ stroke: 'var(--ink)' }} />
          </pattern>
        </defs>
        <line x1="0" x2={W} y1={H} y2={H} strokeWidth="3" style={{ stroke: 'var(--border)' }} />
        {data.map((b, i) => {
          const v = val(b), hc = (v.c / max) * (H - 6), hw = (v.w / max) * (H - 6), x = i * bw + bw * 0.12, w = bw * 0.76;
          return (
            <g key={b.t}>
              {v.c > 0 && <rect x={x} y={H - hc} width={w} height={hc} strokeWidth="1.5" style={{ fill: 'var(--royal)', stroke: 'var(--ink)' }} />}
              {v.w > 0 && <rect x={x} y={H - hc - hw} width={w} height={hw} strokeWidth="1.5" fill="url(#pw)" style={{ stroke: 'var(--ink)' }} />}
            </g>
          );
        })}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={Math.min(W - 14, Math.max(14, i * bw + bw / 2))} y={H + 14} textAnchor="middle" fontSize="10"
            style={{ fill: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{label(data[i], i)}</text>
        ))}
      </svg>
      <figcaption className="flex gap-4 mt-2 nb-label">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 border-[2px] border-[var(--border)]" style={{ background: 'var(--royal)' }} /><Smartphone size={14} strokeWidth={2.5} aria-hidden />SELULER</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 border-[2px] border-[var(--border)] pat-wifi" style={{ background: 'var(--lilac)' }} /><Wifi size={14} strokeWidth={2.5} aria-hidden />WI-FI</span>
      </figcaption>
    </figure>
  );
}

/** Batang hotspot: pink berpola titik (warna + pola + ikon + label di legenda, tidak bergantung warna saja). */
export function HotspotChart({ data, base, label }: { data: HotBucket[]; base: 1000 | 1024; label: (b: HotBucket, i: number) => string }) {
  const max = Math.max(1, ...data.map((b) => b.total));
  const W = 320, H = 130, bw = W / Math.max(1, data.length);
  const total = data.reduce((a, b) => a + b.total, 0);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img"
        aria-label={`Grafik pemakaian hotspot, total ${fmtBytes(total, base)}`}>
        <defs>
          <pattern id="ph" width="7" height="7" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" style={{ fill: 'var(--pink)' }} />
            <circle cx="3.5" cy="3.5" r="1.5" style={{ fill: 'var(--ink)' }} />
          </pattern>
        </defs>
        <line x1="0" x2={W} y1={H} y2={H} strokeWidth="3" style={{ stroke: 'var(--border)' }} />
        {data.map((b, i) => {
          const h = (b.total / max) * (H - 6), x = i * bw + bw * 0.12, w = bw * 0.76;
          return b.total > 0
            ? <rect key={b.t} x={x} y={H - h} width={w} height={h} strokeWidth="1.5" fill="url(#ph)" style={{ stroke: 'var(--ink)' }} />
            : <g key={b.t} />;
        })}
        {data.length > 0 && [0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={Math.min(W - 14, Math.max(14, i * bw + bw / 2))} y={H + 14} textAnchor="middle" fontSize="10"
            style={{ fill: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{label(data[i], i)}</text>
        ))}
      </svg>
      <figcaption className="flex gap-4 mt-2 nb-label">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 border-[2px] border-[var(--border)] pat-hotspot" style={{ backgroundColor: 'var(--pink)' }} /><Radio size={14} strokeWidth={2.5} aria-hidden />HOTSPOT</span>
      </figcaption>
    </figure>
  );
}
