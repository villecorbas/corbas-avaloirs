import { useCallback, useEffect, useState } from 'react';
import { t, useLang } from './i18n';
import { Icon, type IconName } from './components/Icon';
import { Sheet, ToastHost, toast } from './components/ui';
import { handleOsmCallback, type CallbackResult } from './lib/osm';
import { isStandalone, useProgress } from './lib/store';
import { startAutoSync } from './lib/sync';
import { CaptureFlow } from './screens/capture/CaptureFlow';
import { MapScreen } from './screens/MapScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Onboarding } from './screens/Onboarding';
import { InstallGuide } from './screens/InstallGuide';

type Tab = 'map' | 'records' | 'profile' | 'settings';
const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'map', icon: 'map', label: 'tabs.map' },
  { id: 'records', icon: 'list', label: 'tabs.records' },
  { id: 'profile', icon: 'trophy', label: 'tabs.profile' },
  { id: 'settings', icon: 'gear', label: 'tabs.settings' },
];

const ONBOARDED_KEY = 'avaloirs.onboarded';
const INSTALL_DISMISSED_KEY = 'avaloirs.installDismissed';

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function App() {
  useLang();
  const [tab, setTab] = useState<Tab>('map');
  const [capturing, setCapturing] = useState(false);
  const [onboarded, setOnboarded] = useState(() => readFlag(ONBOARDED_KEY));
  const [install, setInstall] = useState(false);
  const [orphanCode, setOrphanCode] = useState<string | null>(null);
  const progress = useProgress();

  useEffect(() => {
    void handleOsmCallback().then((r: CallbackResult) => {
      if (r.kind === 'success') {
        toast(t('accounts.osmConnected'), 'check');
        setTab('settings');
      } else if (r.kind === 'orphan') setOrphanCode(r.code);
      else if (r.kind === 'error') toast(t('accounts.osmError'), 'warning', 'var(--red)');
    });
    startAutoSync();
  }, []);

  const finishOnboarding = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      /* ignore */
    }
    setOnboarded(true);
    if (!isStandalone() && !readFlag(INSTALL_DISMISSED_KEY)) setTimeout(() => setInstall(true), 400);
  };

  const closeInstall = () => {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
    setInstall(false);
  };

  const openAccounts = useCallback(() => setTab('settings'), []);
  const closeCapture = useCallback(() => setCapturing(false), []);

  if (orphanCode) return <OrphanCode code={orphanCode} onClose={() => setOrphanCode(null)} />;
  if (!onboarded) return <Onboarding onDone={finishOnboarding} />;

  return (
    <>
      <main className="app">
        {tab === 'map' && <MapScreen onAdd={() => setCapturing(true)} onOpenProfile={() => setTab('profile')} onOpenAccounts={openAccounts} />}
        {tab === 'records' && <RecordsScreen onOpenAccounts={openAccounts} onAdd={() => setCapturing(true)} />}
        {tab === 'profile' && <ProfileScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      <nav className="tabbar" aria-label={t('tabs.label')}>
        {TABS.map((tb) => (
          <button key={tb.id} aria-current={tab === tb.id ? 'page' : undefined} onClick={() => setTab(tb.id)}>
            <Icon name={tb.icon} size={25} stroke={tab === tb.id ? 2.2 : 1.8} />
            {t(tb.label)}
            {tb.id === 'records' && progress.pending > 0 && <span className="tab-badge">{progress.pending}</span>}
          </button>
        ))}
      </nav>

      {capturing && <CaptureFlow onClose={closeCapture} onOpenAccounts={openAccounts} />}

      <Sheet open={install} onClose={closeInstall} title={t('install.title')} elevated>
        <InstallGuide onDone={closeInstall} />
      </Sheet>
      <ToastHost />
    </>
  );
}

/** Retour OAuth ouvert hors de l'appli installée (navigateur intégré d'iOS) : on affiche le code à recopier. */
function OrphanCode({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <div className="screen" style={{ paddingBottom: 40 }}>
      <div className="stack center" style={{ alignItems: 'center', marginTop: 40 }}>
        <div className="dup-badge">
          <Icon name="key" size={30} />
        </div>
        <h1 className="title1">{t('orphan.title')}</h1>
        <p className="subhead secondary" style={{ margin: 0 }}>{t('orphan.text')}</p>
        <code className="orphan-code selectable">{code}</code>
        <button className="btn" onClick={() => void navigator.clipboard?.writeText(code).then(() => toast(t('share.copied'), 'check'))}>
          {t('orphan.copy')}
        </button>
        <button className="btn plain" onClick={onClose}>
          {t('orphan.continue')}
        </button>
      </div>
      <ToastHost />
    </div>
  );
}
