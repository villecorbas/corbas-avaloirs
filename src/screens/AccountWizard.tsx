import { useEffect, useState } from 'react';
import { getLang, t } from '../i18n';
import { getConfig } from '../lib/config';
import { Icon, type IconName } from '../components/Icon';
import { haptic, Spinner, toast } from '../components/ui';
import { hasPendingLogin, osmConfigured, osmSignupUrl, refreshOsmUser, startOsmLogin } from '../lib/osm';
import { acceptPanoramaxTos, checkPanoramaxUser, openPanoramaxClaim, panoramaxLogout } from '../lib/panoramax';
import { useAuth, usePanoramaxClaimPolling } from '../lib/store';

/** Mémorise qu'il faut rouvrir l'assistant au retour d'openstreetmap.org (la page est rechargée). */
export const WIZARD_RESUME_KEY = 'avaloirs.wizardResume';

export function markWizardResume(on: boolean) {
  try {
    if (on) localStorage.setItem(WIZARD_RESUME_KEY, '1');
    else localStorage.removeItem(WIZARD_RESUME_KEY);
  } catch {
    /* ignore */
  }
}

export function shouldResumeWizard(): boolean {
  try {
    return localStorage.getItem(WIZARD_RESUME_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Assistant de compte : 1. compte OpenStreetMap (création guidée ou connexion),
 * 2. autorisation Panoramax pour les photos, 3. confirmation.
 * Utilisé à la fin de l'accueil et depuis chaque invitation « Connecter mes comptes ».
 */
export function AccountWizard({ onDone, doneLabel }: { onDone: () => void; doneLabel?: string }) {
  const { osm, pnx } = useAuth();
  const [view, setView] = useState<'choice' | 'signup'>('choice');
  const [busy, setBusy] = useState(false);
  const configured = osmConfigured();
  const pnxPending = !!pnx && !pnx.user;
  const tosNeeded = !!pnx?.user && pnx.user.tosAccepted === false;
  const pnxDone = !!pnx?.user && !tosNeeded;
  const step = !osm ? 1 : !pnxDone ? 2 : 3;
  const instance = getConfig().panoramax.instance.replace(/\/$/, '');

  useEffect(() => {
    if (osm && !osm.user) void refreshOsmUser();
    if (pnx) void checkPanoramaxUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePanoramaxClaimPolling(pnxPending, () => haptic('success'));

  const finish = () => {
    markWizardResume(false);
    onDone();
  };

  const goOsm = async (signup: boolean) => {
    haptic();
    setBusy(true);
    markWizardResume(true);
    try {
      await startOsmLogin({ signup });
    } catch {
      setBusy(false);
      toast(t('errors.network'), 'warning', 'var(--red)');
    }
  };

  const goPanoramax = async () => {
    haptic();
    setBusy(true);
    markWizardResume(true);
    try {
      await openPanoramaxClaim();
    } catch {
      toast(t('errors.network'), 'warning', 'var(--red)');
    } finally {
      setBusy(false);
    }
  };

  const later = (
    <button className="btn plain" onClick={finish}>
      {t('wizard.later')}
    </button>
  );

  return (
    <div className="wizard">
      {configured && (
        <div className="wizard-progress" aria-label={t('wizard.progress', { n: Math.min(step, 2), total: 2 })}>
          <span className={step >= 1 ? 'on' : ''} />
          <span className={step >= 2 ? 'on' : ''} />
        </div>
      )}

      {/* ------------------------- Application pas encore enregistrée ------------------------- */}
      {!configured && !osm && (
        <div className="stack slide-in">
          <WizardArt icon="person" />
          <h1 className="title1 center">{t('wizard.title')}</h1>
          <p className="subhead secondary center">{t('wizard.notConfigured')}</p>
          <a className="btn gray" href={osmSignupUrl()} target="_blank" rel="noopener">
            <Icon name="external" size={18} /> {t('wizard.createAhead')}
          </a>
          <button className="btn" onClick={finish}>
            {doneLabel || t('common.continue')}
          </button>
        </div>
      )}

      {/* ------------------------------ Étape 1 : choix ------------------------------ */}
      {configured && step === 1 && view === 'choice' && (
        <div className="stack slide-in">
          <WizardArt icon="person" />
          <h1 className="title1 center">{t('wizard.title')}</h1>
          <p className="subhead secondary center" style={{ margin: 0 }}>
            {t('wizard.intro')}
          </p>
          <ul className="wizard-benefits">
            {(['benefit1', 'benefit2', 'benefit3'] as const).map((k) => (
              <li key={k}>
                <Icon name="check" size={16} stroke={3} />
                <span>{t(`wizard.${k}`)}</span>
              </li>
            ))}
          </ul>
          <button className="btn" onClick={() => setView('signup')} disabled={busy}>
            {t('wizard.create')}
          </button>
          <button className="btn gray" onClick={() => goOsm(false)} disabled={busy}>
            {busy ? <Spinner /> : null}
            {t('wizard.haveAccount')}
          </button>
          {hasPendingLogin() && <p className="footnote secondary center" style={{ margin: 0 }}>{t('wizard.cameBack')}</p>}
          {later}
          <p className="footnote secondary center" style={{ margin: 0 }}>{t('wizard.laterHint')}</p>
        </div>
      )}

      {/* ----------------------- Étape 1 bis : guide d'inscription ----------------------- */}
      {configured && step === 1 && view === 'signup' && (
        <div className="stack slide-in">
          <h1 className="title1">{t('wizard.signupTitle')}</h1>
          <ol className="install-steps">
            {(['signup1', 'signup2', 'signup3'] as const).map((k, i) => (
              <li key={k}>
                <span className="step-num">{i + 1}</span>
                <span>
                  <strong>{t(`wizard.${k}Title`)}</strong>
                  <span className="footnote secondary" style={{ display: 'block', marginTop: 2 }}>
                    {t(`wizard.${k}Text`)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="footnote secondary" style={{ margin: 0 }}>
            💡 {t('wizard.signupTip')}
          </p>
          <button className="btn" onClick={() => goOsm(true)} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="external" size={18} />}
            {t('wizard.openSignup')}
          </button>
          <button className="btn plain" onClick={() => setView('choice')}>
            {t('common.back')}
          </button>
        </div>
      )}

      {/* --------------------------- Étape 2 : Panoramax --------------------------- */}
      {step === 2 && (
        <div className="stack slide-in">
          <div className="center">
            <span className="chip green pop">
              <Icon name="check" size={14} stroke={3} />
              {osm?.user ? t('accounts.connectedAs', { name: osm.user.name }) : t('accounts.osmConnected')}
            </span>
          </div>
          <WizardArt icon="photo" />
          <h1 className="title1 center">{t('wizard.photosTitle')}</h1>
          <p className="subhead secondary center" style={{ margin: 0 }}>
            {t('wizard.photosText')}
          </p>
          {!pnx && (
            <>
              <button className="btn" onClick={goPanoramax} disabled={busy}>
                {busy ? <Spinner /> : null}
                {t('wizard.photosButton')}
              </button>
              <p className="footnote secondary center" style={{ margin: 0 }}>{t('wizard.photosHeads')}</p>
            </>
          )}
          {pnxPending && (
            <PanoramaxWaiting claimUrl={pnx!.claimUrl} onCancel={panoramaxLogout} />
          )}
          {tosNeeded && (
            <div className="card stack" style={{ gap: 10 }}>
              <span className="footnote">
                {t('accounts.pnxTos')}{' '}
                <a href={`${instance}/api/pages/terms-of-service/${getLang()}`} target="_blank" rel="noopener">
                  {t('accounts.pnxTosLink')}
                </a>
              </span>
              <button className="btn" onClick={() => void acceptPanoramaxTos().catch(() => toast(t('errors.network'), 'warning', 'var(--red)'))}>
                {t('accounts.pnxTosAccept')}
              </button>
            </div>
          )}
          {later}
        </div>
      )}

      {/* ------------------------------- Étape 3 : prêt ------------------------------- */}
      {step === 3 && (
        <div className="stack slide-in center" style={{ alignItems: 'center' }}>
          <div className="success-check pop">
            <svg viewBox="0 0 96 96" aria-hidden="true">
              <circle cx="48" cy="48" r="44" fill="var(--accent)" />
              <path className="draw-check" d="m29 49 13 13 26-28" stroke="var(--on-accent)" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="title1">{t('wizard.readyTitle')}</h1>
          <p className="subhead secondary" style={{ margin: 0 }}>
            {t('wizard.readyText')}
          </p>
          <span className="chip accent">{t('wizard.readyBonus')}</span>
          <button className="btn" onClick={finish} style={{ marginTop: 8 }}>
            {doneLabel || t('wizard.start')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Attente de la connexion Panoramax. La page « Connexion terminée » appartient à Panoramax :
 * elle ne ramène pas dans l'application. On guide donc l'utilisateur pas à pas et on vérifie
 * la connexion automatiquement (toutes les 3 s, et dès le retour dans l'appli).
 */
export function PanoramaxWaiting({ claimUrl, onCancel }: { claimUrl: string; onCancel: () => void }) {
  const [checking, setChecking] = useState(false);
  const verify = async () => {
    haptic();
    setChecking(true);
    try {
      const a = await checkPanoramaxUser();
      if (a?.user) haptic('success');
      else toast(t('wizard.notYet'), 'info', 'var(--orange)');
    } catch {
      toast(t('errors.network'), 'warning', 'var(--red)');
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="card stack" style={{ gap: 12 }} role="status">
      <div className="row" style={{ gap: 8 }}>
        <Spinner size={18} />
        <strong>{t('wizard.waitTitle')}</strong>
      </div>
      <ol className="pnx-steps">
        {(['wait1', 'wait2', 'wait3'] as const).map((k, i) => (
          <li key={k}>
            <span className="step-num">{i + 1}</span>
            <span>{t(`wizard.${k}`)}</span>
          </li>
        ))}
      </ol>
      <button className="btn" onClick={verify} disabled={checking}>
        {checking ? <Spinner /> : <Icon name="check" stroke={2.6} />}
        {t('wizard.waitDone')}
      </button>
      <div className="btn-row">
        <a className="btn small tinted" href={claimUrl} target="_blank" rel="noopener">
          {t('accounts.pnxReopen')}
        </a>
        <button className="btn small gray" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function WizardArt({ icon }: { icon: IconName }) {
  return (
    <div className="wizard-art" aria-hidden="true">
      <Icon name={icon} size={44} stroke={1.7} />
      <span className="wizard-art-badge">
        <Icon name="map" size={18} stroke={2.2} />
      </span>
    </div>
  );
}
