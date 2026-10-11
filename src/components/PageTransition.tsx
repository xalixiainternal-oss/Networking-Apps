import { useEffect, useRef, useState, type ReactNode } from 'react';

const OUT_MS = 140; // harus sama dengan durasi .page-wrap[data-phase="out"] di index.css

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Fade out halaman lama, lalu fade in halaman baru.
 * Konten dengan pageKey yang sama tetap hidup (state & update jalan normal).
 */
export function PageTransition({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const [shownKey, setShownKey] = useState(pageKey);
  const [phase, setPhase]       = useState<'in' | 'out'>('in');
  const lastNode  = useRef<ReactNode>(children);
  const latest    = useRef<ReactNode>(children);
  latest.current  = children;
  if (pageKey === shownKey) lastNode.current = children;

  useEffect(() => {
    if (pageKey === shownKey) { setPhase('in'); return; }
    setPhase('out');
    const id = setTimeout(() => {
      window.scrollTo(0, 0);
      setShownKey(pageKey);
      setPhase('in');
    }, reduced() ? 0 : OUT_MS);
    return () => clearTimeout(id);
  }, [pageKey, shownKey]);

  // Selama fade out, tampilkan snapshot halaman lama.
  const node = pageKey === shownKey ? children : lastNode.current;

  return (
    <div className="page-wrap" data-phase={phase}>
      <div key={shownKey}>{node}</div>
    </div>
  );
}
