import type { ReactNode } from 'react';
import { Plate } from './ui';

interface HeaderProps {
  title: string;
  /** Elemen kiri (misal tombol Kembali). Bila ada, judul di kanan. */
  left?: ReactNode;
}

export function Header({ title, left }: HeaderProps) {
  return (
    <header className="grad-3 nb-box safe-top p-4 flex items-center gap-3"
      style={{ borderRadius: 0, borderTop: 0, borderInline: 0 }}>
      {left}
      {title && <Plate><h1 className="m-0 text-2xl font-bold">{title}</h1></Plate>}
    </header>
  );
}
