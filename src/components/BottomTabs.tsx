import { LayoutDashboard, AppWindow, Wifi, Settings } from 'lucide-react';

export type TabId = 'dashboard' | 'aplikasi' | 'hotspot' | 'pengaturan';
const TABS = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'aplikasi', label: 'Aplikasi', Icon: AppWindow },
  { id: 'hotspot', label: 'Hotspot', Icon: Wifi },
  { id: 'pengaturan', label: 'Pengaturan', Icon: Settings },
] as const;

export function BottomTabs({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav aria-label="Navigasi utama" className="fixed bottom-0 inset-x-0 safe-bottom bg-bg border-t-[3px] border-[var(--border)]">
      <ul className="grid grid-cols-4 gap-2 p-2 m-0 list-none">
        {TABS.map(({ id, label, Icon }) => {
          const on = id === active;
          return (
            <li key={id}>
              <button onClick={() => onChange(id)} aria-current={on ? 'page' : undefined}
                className={`nb-box nb-press w-full py-1 flex flex-col items-center text-[0.7rem] font-bold ${on ? 'bg-royal text-paper' : 'bg-surface text-text'}`}
                style={{ ['--sh' as string]: on ? '3px' : '0px', borderColor: on ? 'var(--ink)' : 'transparent', boxShadow: on ? undefined : 'none' }}>
                <Icon size={22} strokeWidth={2.5} aria-hidden />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
