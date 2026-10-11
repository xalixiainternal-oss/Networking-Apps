import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, TriangleAlert } from 'lucide-react';
import type { Amount, Unit } from '../lib/settings';

export function Card({ children, className = '', tone = 'surface' }:
  { children: ReactNode; className?: string; tone?: 'surface' | 'pink' | 'lilac' | 'royal' | 'deep' }) {
  const tones: Record<string, string> = {
    surface: 'bg-surface text-text',
    pink:    'bg-pink text-ink',
    lilac:   'bg-lilac text-ink',
    royal:   'bg-royal text-paper',
    deep:    'bg-deep text-paper',
  };
  return <div className={`nb-box p-4 ${tones[tone]} ${className}`}>{children}</div>;
}

export function GradCard({ children, grad = 4, className = '' }:
  { children: ReactNode; grad?: 1 | 2 | 3 | 4; className?: string }) {
  return <div className={`nb-box grad-${grad} p-4 ${className}`}>{children}</div>;
}

export function Plate({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`nb-box bg-paper text-ink px-3 py-1 inline-block ${className}`}
      style={{ ['--sh' as string]: '3px' }}>
      {children}
    </div>
  );
}

type Variant = 'primary' | 'ghost' | 'pink' | 'lilac';
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export function Button({ variant = 'primary', className = '', ...p }: BtnProps) {
  const v: Record<Variant, string> = {
    primary: 'bg-royal text-paper',
    ghost:   'bg-surface text-text',
    pink:    'bg-pink text-ink',
    lilac:   'bg-lilac text-ink',
  };
  return (
    <button {...p}
      className={`nb-box nb-press ${v[variant]} px-4 py-2 font-bold text-base ${className}`} />
  );
}

export function Fab({ label, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...p} aria-label={label}
      className="nb-box nb-press bg-royal text-paper fixed right-4 bottom-24 w-14 h-14 grid place-items-center">
      {children}
    </button>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const p     = Math.max(0, percent);
  const state = p >= 100 ? 'habis' : p >= 90 ? 'kritis' : p >= 80 ? 'waspada' : 'aman';
  const fill  = { aman: 'var(--royal)', waspada: 'var(--lilac)', kritis: 'var(--pink)', habis: 'var(--alert)' }[state];
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="nb-label">{label}</span>
        <span className="nb-num flex items-center gap-1">
          {state === 'waspada' && <AlertTriangle size={16} strokeWidth={2.5} aria-hidden />}
          {state === 'kritis'  && <><TriangleAlert size={16} strokeWidth={2.5} aria-hidden /><b>HAMPIR HABIS</b></>}
          {state === 'habis'   && <b>HABIS</b>}
          {Math.round(p)}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}
        aria-label={`${label}: ${Math.round(p)} persen terpakai`}
        className="nb-box h-7 overflow-hidden"
        style={{ ['--sh' as string]: '3px', background: 'var(--surface)' }}>
        <div style={{
          width: `${Math.min(100, p)}%`, height: '100%', background: fill,
          borderRight: p > 0 && p < 100 ? 'var(--bw) solid var(--ink)' : undefined,
        }} />
      </div>
    </div>
  );
}

export const FIELD = 'nb-box bg-surface text-text px-3 min-h-12 w-full font-bold';

/** Saklar teks + keterangan. Target sentuh ≥ 48dp lewat seluruh baris label. */
export function Toggle({ checked, onChange, label, hint, disabled }:
  { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 min-h-12 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} className="w-6 h-6 mt-0.5 shrink-0 accent-royal" />
      <span className="min-w-0">
        <span className="font-bold block">{label}</span>
        {hint && <span className="block text-sm opacity-80 leading-snug">{hint}</span>}
      </span>
    </label>
  );
}

/** Isian jumlah + satuan (MB/GB). 0 = tidak dipakai. */
export function AmountField({ id, label, value, onChange }:
  { id: string; label: string; value: Amount; onChange: (a: Amount) => void }) {
  return (
    <div>
      <label className="nb-label block mb-1" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input id={id} className={FIELD} type="number" inputMode="decimal" min={0} step="any"
          value={value.v || ''} placeholder="0"
          onChange={(e) => onChange({ ...value, v: Math.max(0, Number(e.target.value) || 0) })} />
        <select aria-label={`Satuan ${label}`} className={`${FIELD} w-28`} value={value.u}
          onChange={(e) => onChange({ ...value, u: e.target.value as Unit })}>
          <option>MB</option><option>GB</option>
        </select>
      </div>
    </div>
  );
}

/** Pilihan satu-dari-banyak berupa deretan tombol. */
export function Seg<T extends string | number>({ value, options, onChange, label }:
  { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([v, l]) => (
        <Button key={String(v)} variant={v === value ? 'primary' : 'ghost'} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</Button>
      ))}
    </div>
  );
}
