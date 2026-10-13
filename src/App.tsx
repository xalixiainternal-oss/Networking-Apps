import { useEffect, useState } from 'react';
import { BottomTabs, type TabId } from './components/BottomTabs';
import { Onboarding } from './components/Onboarding';
import { Dashboard } from './components/Dashboard';
import { AppsPage } from './components/AppsPage';
import { SettingsPage } from './components/SettingsPage';
import { HotspotPage } from './components/HotspotPage';
import { PrankPage } from './components/PrankPage';
import { PageTransition } from './components/PageTransition';
import { Quota } from './lib/quotaPlugin';
import { applyTheme, useSettings } from './lib/settings';
import { pushConfig } from './lib/nativeConfig';

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('onboarded') === '1');
  const [tab, setTab]             = useState<TabId>('dashboard');
  const settings                  = useSettings();
  const { theme }                 = settings;

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const f  = () => applyTheme(theme);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [theme]);

  // Kirim konfigurasi ke Kotlin; perubahan pengaturan didorong dengan jeda 400 ms.
  useEffect(() => {
    if (!onboarded) return;
    const id = setTimeout(() => { void pushConfig(settings); }, 400);
    return () => clearTimeout(id);
  }, [onboarded, settings]);

  // Saat app dibuka: konfigurasi dulu, baru startTracking, supaya layanan latar memakai pengaturan terbaru.
  useEffect(() => {
    if (!onboarded) return;
    pushConfig(settings).finally(() => { Quota.startTracking().catch(() => {}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarded]);

  if (!onboarded)
    return <Onboarding onDone={() => { localStorage.setItem('onboarded', '1'); setOnboarded(true); }} />;

  return (
    <div className="min-h-full pb-28">
      <PageTransition pageKey={tab}>
        {tab === 'dashboard'  && <Dashboard onGoToApps={() => setTab('aplikasi')} />}
        {tab === 'aplikasi'   && <AppsPage />}
        {tab === 'hotspot'    && <HotspotPage />}
        {tab === 'prank'      && <PrankPage />}
        {tab === 'pengaturan' && <SettingsPage />}
      </PageTransition>
      <BottomTabs active={tab} onChange={setTab} />
    </div>
  );
}
