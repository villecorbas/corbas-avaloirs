import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { platform } from '../lib/store';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** À appeler au démarrage : Android/Chrome propose l'installation via cet événement. */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
}

function ShareGlyph() {
  return (
    <span className="inline-glyph" aria-label={t('install.shareButton')}>
      <Icon name="share" size={17} style={{ color: 'var(--blue)' }} />
    </span>
  );
}

export function InstallGuide({ onDone }: { onDone: () => void }) {
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  useEffect(() => {
    const l = () => setCanPrompt(!!deferred);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const os = platform();

  return (
    <div className="stack">
      <div className="install-hero">
        <img src="./icons/icon-192.png" alt="" width={72} height={72} />
        <div>
          <div className="headline">{t('install.heroTitle')}</div>
          <div className="footnote secondary">{t('install.heroText')}</div>
        </div>
      </div>

      {canPrompt ? (
        <button
          className="btn"
          onClick={async () => {
            await deferred?.prompt();
            const choice = await deferred?.userChoice;
            deferred = null;
            setCanPrompt(false);
            if (choice?.outcome === 'accepted') onDone();
          }}
        >
          <Icon name="download" /> {t('install.button')}
        </button>
      ) : os === 'ios' ? (
        <ol className="install-steps">
          <li>
            <span className="step-num">1</span>
            <span>
              {t('install.ios1a')} <ShareGlyph /> {t('install.ios1b')}
            </span>
          </li>
          <li>
            <span className="step-num">2</span>
            <span>{t('install.ios2')}</span>
          </li>
          <li>
            <span className="step-num">3</span>
            <span>{t('install.ios3')}</span>
          </li>
        </ol>
      ) : (
        <ol className="install-steps">
          <li>
            <span className="step-num">1</span>
            <span>{t('install.android1')}</span>
          </li>
          <li>
            <span className="step-num">2</span>
            <span>{t('install.android2')}</span>
          </li>
          <li>
            <span className="step-num">3</span>
            <span>{t('install.android3')}</span>
          </li>
        </ol>
      )}
      {os === 'ios' && <p className="footnote secondary" style={{ margin: 0 }}>{t('install.iosSafari')}</p>}
      <button className="btn plain" onClick={onDone}>
        {t('install.later')}
      </button>
    </div>
  );
}
