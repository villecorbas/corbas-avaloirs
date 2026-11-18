import { useEffect, useState } from 'react';
import { getConfig, osmUrls } from '../lib/config';
import { getLang, t } from '../i18n';
import { Icon } from '../components/Icon';
import { Spinner, toast } from '../components/ui';
import {
  completeOsmLoginWithCode,
  hasPendingLogin,
  osmConfigured,
  osmLogout,
  refreshOsmUser,
  startOsmLogin,
} from '../lib/osm';
import {
  acceptPanoramaxTos,
  checkPanoramaxUser,
  panoramaxLogout,
  startPanoramaxLogin,
} from '../lib/panoramax';
import { useAuth } from '../lib/store';

/** Section « Comptes » : OpenStreetMap (OAuth 2) puis Panoramax (jeton réclamé). */
export function Accounts() {
  const { osm, pnx } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'osm' | 'pnx' | null>(null);
  const pendingOsm = !osm && hasPendingLogin();
  const pnxPending = !!pnx && !pnx.user;
  const instance = getConfig().panoramax.instance.replace(/\/$/, '');

  useEffect(() => {
    if (osm) void refreshOsmUser();
    if (pnx) void checkPanoramaxUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // En attente de réclamation du jeton Panoramax : on vérifie régulièrement.
  useEffect(() => {
    if (!pnxPending) return;
    const check = () => void checkPanoramaxUser().then((a) => a?.user && toast(t('accounts.pnxConnected'), 'check'));
    const id = setInterval(check, 3000);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [pnxPending]);

  const connectOsm = async () => {
    setBusy('osm');
    try {
      await startOsmLogin();
    } catch {
      setBusy(null);
      toast(t('errors.network'), 'warning', 'var(--red)');
    }
  };

  const connectPnx = async () => {
    setBusy('pnx');
    // La fenêtre doit être ouverte pendant le geste (sinon bloquée par Safari).
    const win = window.open('about:blank', '_blank');
    try {
      const a = await startPanoramaxLogin();
      if (win) win.location.href = a.claimUrl;
      else window.open(a.claimUrl, '_blank');
    } catch {
      win?.close();
      toast(t('errors.network'), 'warning', 'var(--red)');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3 className="section-title">{t('accounts.title')}</h3>
      <div className="list">
        {/* ------------------------- OpenStreetMap ------------------------- */}
        <div className="list-row" style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14 }}>
          <span className="icon-tile" style={{ background: '#7ebc6f' }}>
            <Icon name="map" size={17} />
          </span>
          <div className="stack" style={{ flex: 1, gap: 8 }}>
            <div>
              <div className="headline">OpenStreetMap</div>
              <div className="footnote secondary">
                {osm?.user
                  ? t('accounts.connectedAs', { name: osm.user.name })
                  : osmUrls().dev
                    ? t('accounts.osmDev')
                    : t('accounts.osmWhy')}
              </div>
            </div>
            {!osmConfigured() && <div className="footnote" style={{ color: 'var(--orange)' }}>{t('accounts.osmNotConfigured')}</div>}
            {osm ? (
              <button className="btn small gray" onClick={osmLogout}>
                {t('accounts.logout')}
              </button>
            ) : (
              <>
                <button className="btn" onClick={connectOsm} disabled={!osmConfigured() || busy === 'osm'}>
                  {busy === 'osm' ? <Spinner /> : null}
                  {t('accounts.osmConnect')}
                </button>
                <a className="footnote" href={`${osmUrls().web}/user/new`} target="_blank" rel="noopener">
                  {t('accounts.osmCreate')}
                </a>
              </>
            )}
            {pendingOsm && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="footnote secondary">{t('accounts.osmCodeHint')}</span>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="text-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t('accounts.osmCodePlaceholder')}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    className="btn small"
                    disabled={code.trim().length < 10}
                    onClick={async () => {
                      try {
                        await completeOsmLoginWithCode(code);
                        setCode('');
                        toast(t('accounts.osmConnected'), 'check');
                      } catch {
                        toast(t('accounts.osmCodeError'), 'warning', 'var(--red)');
                      }
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* --------------------------- Panoramax --------------------------- */}
        <div className="list-row" style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14, ['--inset' as string]: '57px' }}>
          <span className="icon-tile" style={{ background: '#c6a96b' }}>
            <Icon name="photo" size={17} />
          </span>
          <div className="stack" style={{ flex: 1, gap: 8 }}>
            <div>
              <div className="headline">Panoramax</div>
              <div className="footnote secondary">
                {pnx?.user ? t('accounts.connectedAs', { name: pnx.user.name }) : t('accounts.pnxWhy')}
              </div>
            </div>
            {!pnx && (
              <button className="btn" onClick={connectPnx} disabled={busy === 'pnx'}>
                {busy === 'pnx' ? <Spinner /> : null}
                {t('accounts.pnxConnect')}
              </button>
            )}
            {pnxPending && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row footnote">
                  <Spinner size={16} /> {t('accounts.pnxWaiting')}
                </div>
                <div className="btn-row">
                  <a className="btn small tinted" href={pnx!.claimUrl} target="_blank" rel="noopener">
                    {t('accounts.pnxReopen')}
                  </a>
                  <button className="btn small gray" onClick={panoramaxLogout}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
            {pnx?.user && pnx.user.tosAccepted === false && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="footnote" style={{ color: 'var(--orange)' }}>
                  {t('accounts.pnxTos')}{' '}
                  <a href={`${instance}/api/pages/terms-of-service/${getLang()}`} target="_blank" rel="noopener">
                    {t('accounts.pnxTosLink')}
                  </a>
                </span>
                <button className="btn small" onClick={() => void acceptPanoramaxTos().catch(() => toast(t('errors.network'), 'warning', 'var(--red)'))}>
                  {t('accounts.pnxTosAccept')}
                </button>
              </div>
            )}
            {pnx?.user && (
              <button className="btn small gray" onClick={panoramaxLogout}>
                {t('accounts.logout')}
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="section-footer">{t('accounts.footer')}</p>
    </>
  );
}
