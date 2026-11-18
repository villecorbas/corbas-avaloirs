import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getConfig } from '../lib/config';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { haptic, Ring } from '../components/ui';
import { DrainIllustration } from '../components/DrainIllustration';
import { enableCompass, requestLocationPermission } from '../lib/location';
import { platform } from '../lib/store';
import { invitedBy } from '../lib/invite';

const PAGE_KEY = 'avaloirs.onboardingPage';
const PAGES = 4;
const PERMISSIONS_PAGE = 3; // dernière page : le compte OpenStreetMap n'est demandé qu'après le premier avaloir relevé

function savedPage(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_KEY));
    return Number.isInteger(n) && n > 0 && n < PAGES ? n : 0;
  } catch {
    return 0;
  }
}

type Perm = 'idle' | 'granted' | 'denied';

export function Onboarding({ onDone }: { onDone: () => void }) {
  // Reprend à la bonne page au retour d'openstreetmap.org (la page est rechargée).
  const [page, setPage] = useState(savedPage);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && page) el.scrollTo({ left: page * el.clientWidth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PAGE_KEY, String(page));
    } catch {
      /* ignore */
    }
  }, [page]);
  const [geo, setGeo] = useState<Perm>('idle');
  const [cam, setCam] = useState<Perm>('idle');
  const [compass, setCompass] = useState<Perm>('idle');

  const goTo = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  const askCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      s.getTracks().forEach((tr) => tr.stop());
      setCam('granted');
    } catch {
      setCam('denied');
    }
  };

  const needsCompassPermission = platform() === 'ios';

  const finish = () => {
    if (!needsCompassPermission) void enableCompass();
    try {
      localStorage.removeItem(PAGE_KEY);
    } catch {
      /* ignore */
    }
    onDone();
  };

  return (
    <div className="onboarding">
      {page < PERMISSIONS_PAGE && (
        <button className="btn plain onboarding-skip" onClick={() => goTo(PERMISSIONS_PAGE)}>
          {t('onboarding.skip')}
        </button>
      )}
      <div
        className="onboarding-pages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const p = Math.round(el.scrollLeft / el.clientWidth);
          if (p !== page) setPage(p);
        }}
      >
        <section className="onboarding-page">
          <div className="onboarding-art">
            <div className="art-circle">
              <DrainIllustration type="kerb_grate" className="art-drain" />
              <MosquitoBadge />
            </div>
          </div>
          {invitedBy() && (
            <div className="center">
              <span className="chip accent pop">🎉 {t('onboarding.invitedBy', { name: invitedBy()! })}</span>
            </div>
          )}
          <h1 className="title1 center">{t('onboarding.p1Title')}</h1>
          <p className="subhead secondary center">{t('onboarding.p1Text')}</p>
          <p className="footnote secondary center">{getConfig().campaignName}</p>
        </section>

        <section className="onboarding-page">
          <h1 className="title1 center" style={{ marginTop: 24 }}>{t('onboarding.p2Title')}</h1>
          <div className="how-steps">
            {[
              { icon: 'camera' as const, color: 'var(--orange)', key: 'step1' },
              { icon: 'location' as const, color: 'var(--blue)', key: 'step2' },
              { icon: 'grate' as const, color: 'var(--accent)', key: 'step3' },
              { icon: 'cloudUp' as const, color: 'var(--indigo)', key: 'step4' },
            ].map((s, i) => (
              <div key={s.key} className="how-step slide-in" style={{ animationDelay: `${i * 0.08}s` }}>
                <span className="icon-tile" style={{ background: s.color, width: 44, height: 44, borderRadius: 12 }}>
                  <Icon name={s.icon} size={24} />
                </span>
                <div>
                  <div className="headline">{t(`onboarding.${s.key}Title`)}</div>
                  <div className="footnote secondary">{t(`onboarding.${s.key}Text`)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="onboarding-page">
          <div className="onboarding-art">
            <div className="game-preview">
              <Ring progress={0.7} size={120} width={12} color="var(--accent)">
                <div className="center">
                  <div className="caption secondary">{t('level.short')}</div>
                  <div className="title1 rounded-num">4</div>
                </div>
              </Ring>
              <div className="medals-row">
                {['🎯', '🔥', '📍', '🧭'].map((m, i) => (
                  <span key={m} className="medal pop" style={{ animationDelay: `${0.2 + i * 0.1}s`, background: ['#34c759', '#ff9500', '#0a84ff', '#5e5ce6'][i] }}>
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <h1 className="title1 center">{t('onboarding.p3Title')}</h1>
          <p className="subhead secondary center">{t('onboarding.p3Text')}</p>
        </section>

        <section className="onboarding-page">
          <h1 className="title1 center" style={{ marginTop: 24 }}>{t('onboarding.p4Title')}</h1>
          <p className="subhead secondary center">{t('onboarding.p4Text')}</p>
          <div className="list" style={{ marginTop: 8 }}>
            <PermRow
              icon="location"
              color="var(--blue)"
              title={t('onboarding.permLocation')}
              text={t('onboarding.permLocationText')}
              state={geo}
              onAsk={async () => setGeo((await requestLocationPermission()) ? 'granted' : 'denied')}
            />
            <PermRow icon="camera" color="var(--orange)" title={t('onboarding.permCamera')} text={t('onboarding.permCameraText')} state={cam} onAsk={askCamera} />
            {needsCompassPermission && (
              <PermRow
                icon="compass"
                color="var(--red)"
                title={t('onboarding.permCompass')}
                text={t('onboarding.permCompassText')}
                state={compass}
                onAsk={async () => setCompass((await enableCompass()) ? 'granted' : 'denied')}
              />
            )}
          </div>
          <p className="footnote secondary center" style={{ marginTop: 14 }}>{t('onboarding.privacy')}</p>
        </section>
      </div>

      <div className="onboarding-footer">
        <div className="dots" role="tablist">
          {Array.from({ length: PAGES }, (_, i) => (
            <button key={i} className={i === page ? 'on' : ''} onClick={() => goTo(i)} aria-label={t('onboarding.page', { n: i + 1 })} />
          ))}
        </div>
        <button
          className="btn"
          onClick={() => {
            haptic();
            if (page < PERMISSIONS_PAGE) goTo(page + 1);
            else finish();
          }}
        >
          {page < PERMISSIONS_PAGE ? t('common.continue') : t('onboarding.start')}
        </button>
      </div>
    </div>
  );
}

function PermRow({ icon, color, title, text, state, onAsk }: { icon: 'location' | 'camera' | 'compass'; color: string; title: string; text: string; state: Perm; onAsk: () => void }) {
  return (
    <div className="list-row" style={{ ['--inset' as string]: '57px', paddingTop: 12, paddingBottom: 12 }}>
      <span className="icon-tile" style={{ background: color }}>
        <Icon name={icon} size={17} />
      </span>
      <div style={{ flex: 1 }}>
        <div className="headline">{title}</div>
        <div className="footnote secondary">{text}</div>
      </div>
      {state === 'granted' ? (
        <span className="perm-ok pop">
          <Icon name="check" size={18} stroke={3} />
        </span>
      ) : (
        <button className={`btn small ${state === 'denied' ? 'danger' : 'tinted'}`} onClick={onAsk}>
          {state === 'denied' ? t('onboarding.denied') : t('onboarding.allow')}
        </button>
      )}
    </div>
  );
}

/** Moustique tigre stylisé (noir rayé de blanc), barré. */
function MosquitoBadge() {
  return (
    <svg className="mosquito" viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="38" fill="#fff" stroke="#ff3b30" strokeWidth="5" />
      <g transform="translate(40 41) rotate(-20)">
        <ellipse cx="-9" cy="-12" rx="13" ry="5" fill="#cfe7ff" opacity=".9" transform="rotate(-25)" />
        <ellipse cx="9" cy="-12" rx="13" ry="5" fill="#cfe7ff" opacity=".9" transform="rotate(25)" />
        <path d="M-6 2-18 14M-3 4-10 20M3 4 10 20M6 2 18 14M-6-1-20 2M6-1 20 2" stroke="#1c1c1e" strokeWidth="2" strokeLinecap="round" />
        <path d="M-16 13.5h3M-10 18h3M8 18h3M14 13.5h3" stroke="#fff" strokeWidth="1.4" />
        <ellipse cx="0" cy="2" rx="5" ry="9" fill="#1c1c1e" />
        <path d="M-4.5 0h9M-4.5 4h9M-4 8h8" stroke="#fff" strokeWidth="1.3" />
        <circle cx="0" cy="-9" r="4.5" fill="#1c1c1e" />
        <path d="M0-13v-9" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M0-6.5V-11" stroke="#fff" strokeWidth="1.2" />
      </g>
      <path d="M14 66 66 14" stroke="#ff3b30" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
