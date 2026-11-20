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
import { AccountWizard, markWizardResume, shouldResumeWizard } from './screens/AccountWizard';
import { LockedNudge } from './components/LockedReminder';
import { InviteScreen } from './screens/InviteScreen';
import { CampaignScreen } from './screens/CampaignScreen';
import { consumeCampaignLink } from './lib/invite';
import { ShareScoreScreen } from './screens/ShareScoreScreen';
import { getOsmAuth, osmConfigured } from './lib/osm';

type Tab = 'map' | 'records' | 'profile' | 'settings';
const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'map', icon: 'map', label: 'tabs.map' },
  { id: 'records', icon: 'list', label: 'tabs.records' },
  { id: 'profile', icon: 'trophy', label: 'tabs.profile' },
  { id: 'settings', icon: 'gear', label: 'tabs.settings' },
];

const ONBOARDED_KEY = 'avaloirs.onboarded';
const INSTALL_SNOOZE_KEY = 'avaloirs.installSnoozeUntil';
const INSTALL_REFUSALS_KEY = 'avaloirs.installRefusals';
const DAY = 24 * 3600 * 1000;
const NUDGE_KEY = 'avaloirs.lastNudge';
const NUDGE_INTERVAL = 12 * 3600 * 1000;

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
  // Assistant de compte, rouvert automatiquement au retour d'openstreetmap.org.
  const [wizard, setWizard] = useState(() => readFlag(ONBOARDED_KEY) && shouldResumeWizard());
  const progress = useProgress();

  useEffect(() => {
    void handleOsmCallback().then((r: CallbackResult) => {
      if (r.kind === 'success') {
        toast(t('accounts.osmConnected'), 'check');
        if (!shouldResumeWizard()) setTab('settings');
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
  };

  /**
   * Au lancement, l'appli vérifie si elle est ajoutée à l'écran d'accueil (mode « standalone »).
   * Sinon, elle propose l'installation. Un refus reporte la proposition d'un jour (puis d'une
   * semaine après 3 refus) pour ne pas harceler ; installer l'appli la fait cesser définitivement.
   */
  const closeInstall = () => {
    try {
      const n = Number(localStorage.getItem(INSTALL_REFUSALS_KEY) || 0) + 1;
      localStorage.setItem(INSTALL_REFUSALS_KEY, String(n));
      localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now() + (n >= 3 ? 7 * DAY : DAY)));
    } catch {
      /* ignore */
    }
    setInstall(false);
  };

  useEffect(() => {
    if (!onboarded || isStandalone()) return;
    let snoozed = 0;
    try {
      snoozed = Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || 0);
    } catch {
      /* ignore */
    }
    if (Date.now() < snoozed) return;
    const timer = setTimeout(() => setInstall(true), 1200);
    // Installation réussie depuis Chrome : la proposition disparaît d'elle-même.
    const done = () => setInstall(false);
    window.addEventListener('appinstalled', done);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('appinstalled', done);
    };
  }, [onboarded]);

  // Rappel « travail non envoyé » (au plus toutes les 12 h) pour les contributeurs sans compte.
  const [nudge, setNudge] = useState(false);
  const [social, setSocial] = useState<'invite' | 'share' | 'campaign' | null>(null);
  // Lien de campagne (?rues) : ouvre « Adoptez une rue » une fois l'accueil passé.
  useEffect(() => {
    if (onboarded && !capturing && consumeCampaignLink()) setSocial('campaign');
  }, [onboarded, capturing]);
  useEffect(() => {
    const check = () => {
      if (!onboarded || install || capturing || wizard || !osmConfigured() || getOsmAuth() || progress.unsent === 0) return;
      let last = 0;
      try {
        last = Number(localStorage.getItem(NUDGE_KEY) || 0);
      } catch {
        /* ignore */
      }
      if (Date.now() - last < NUDGE_INTERVAL) return;
      try {
        localStorage.setItem(NUDGE_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      setNudge(true);
    };
    const timer = setTimeout(check, 1200);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [onboarded, install, capturing, wizard, progress.unsent]);

  const openAccounts = useCallback(() => setWizard(true), []);
  const closeWizard = () => {
    markWizardResume(false);
    setWizard(false);
    // « Plus tard » : on ne rappelle pas immédiatement la même demande.
    if (!getOsmAuth()) {
      try {
        localStorage.setItem(NUDGE_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    }
  };
  const closeCapture = useCallback(() => setCapturing(false), []);

  if (orphanCode) return <OrphanCode code={orphanCode} onClose={() => setOrphanCode(null)} />;
  if (!onboarded) return <Onboarding onDone={finishOnboarding} />;

  return (
    <>
      <main className="app">
        {tab === 'map' && <MapScreen onAdd={() => setCapturing(true)} onOpenProfile={() => setTab('profile')} onOpenAccounts={openAccounts} />}
        {tab === 'records' && <RecordsScreen onOpenAccounts={openAccounts} onAdd={() => setCapturing(true)} />}
        {tab === 'profile' && <ProfileScreen onConnect={openAccounts} onInvite={() => setSocial('invite')} onShare={() => setSocial('share')} onCampaign={() => setSocial('campaign')} />}
        {tab === 'settings' && <SettingsScreen onInvite={() => setSocial('invite')} onCampaign={() => setSocial('campaign')} />}
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

      {capturing && <CaptureFlow onClose={closeCapture} onOpenAccounts={openAccounts} onOpenInvite={() => setSocial('invite')} />}

      {wizard && (
        <div className="wizard-modal" role="dialog" aria-modal="true" aria-label={t('wizard.title')}>
          <button className="icon-btn wizard-close" onClick={closeWizard} aria-label={t('common.close')}>
            <Icon name="close" stroke={2.4} />
          </button>
          <AccountWizard onDone={closeWizard} doneLabel={t('wizard.done')} />
        </div>
      )}

      {social === 'invite' && <InviteScreen onClose={() => setSocial(null)} />}
      {social === 'share' && <ShareScoreScreen onClose={() => setSocial(null)} />}
      {social === 'campaign' && <CampaignScreen onClose={() => setSocial(null)} />}

      <Sheet open={nudge} onClose={() => setNudge(false)} elevated>
        <LockedNudge
          count={progress.unsent}
          points={progress.lockedPoints}
          onConnect={() => {
            setNudge(false);
            setWizard(true);
          }}
          onLater={() => setNudge(false)}
        />
      </Sheet>

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
