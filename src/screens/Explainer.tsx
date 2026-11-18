import { t } from '../i18n';
import { DrainIllustration } from '../components/DrainIllustration';
import type { DrainType } from '../lib/taxonomy';

/** Moustique tigre stylisé (noir rayé de blanc), barré. */
export function MosquitoBadge({ className = 'mosquito' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 80 80" aria-hidden="true">
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

/** Coupe d'un avaloir : l'eau de pluie descend, le fond garde l'eau, les larves s'y développent. */
export function DrainCutaway() {
  const larva = (x: number, y: number, r = 0) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r})`}>
      <path d="M0 0q5-7 10 0t10 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="-1.5" cy="0" r="2.4" fill="#fff" />
    </g>
  );
  return (
    <svg className="illu cutaway" viewBox="0 0 320 220" role="img" aria-label={t('explain.cutawayAlt')}>
      <rect width="320" height="220" fill="var(--ill-soil)" />
      <rect y="28" width="320" height="22" fill="var(--ill-road)" />
      <rect x="125" y="34" width="70" height="161" fill="var(--ill-hole)" />
      <rect x="195" y="120" width="125" height="18" fill="var(--ill-hole)" />
      <rect x="125" y="138" width="70" height="57" fill="var(--ill-water)" opacity=".8" />
      <rect x="118" y="25" width="84" height="9" rx="2" fill="var(--ill-metal)" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={124 + i * 12.5} y="27" width="5" height="5" rx="1" fill="var(--ill-hole)" />
      ))}
      {[138, 158, 178].map((x, i) => (
        <path key={x} d={`M${x} ${4 + i * 3}v12m-3-4 3 4 3-4`} stroke="var(--ill-water)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      <path d="M160 36v82" stroke="var(--ill-water)" strokeWidth="2" strokeDasharray="3 5" opacity=".7" />
      <path d="M198 128h120" stroke="var(--ill-water)" strokeWidth="2" strokeDasharray="3 5" opacity=".7" />
      {larva(135, 158, -8)}
      {larva(158, 172, 6)}
      {larva(140, 183, 0)}
      <text x="214" y="20" fontSize="22">🦟</text>
      <g fill="#fff" fontSize="13" fontWeight="600" stroke="rgba(0,0,0,.35)" strokeWidth=".4">
        <text x="10" y="78">{t('explain.grate')}</text>
        <text x="10" y="178">{t('explain.water')}</text>
        <text x="205" y="170">{t('explain.larvae')}</text>
        <text x="205" y="112">{t('explain.network')}</text>
      </g>
      <g stroke="#fff" strokeWidth="1.4" fill="none" opacity=".9">
        <path d="M52 70 118 34" />
        <path d="M92 173 124 170" />
        <path d="M200 164 168 172" />
      </g>
    </svg>
  );
}

const VARIETY: DrainType[] = ['grate', 'kerb_grate', 'kerb_opening'];

/** Les trois pages d'explication (accueil et réglages). */
export function ExplainMosquito() {
  return (
    <>
      <div className="onboarding-art">
        <div className="art-circle plain">
          <MosquitoBadge className="mosquito huge" />
        </div>
      </div>
      <h1 className="title1 center">{t('onboarding.p1Title')}</h1>
      <p className="subhead secondary center">{t('onboarding.p1Text')}</p>
    </>
  );
}

export function ExplainDrain() {
  return (
    <>
      <div className="variety" aria-hidden="true">
        {VARIETY.map((ty) => (
          <figure key={ty}>
            <div className="variety-img">
              <DrainIllustration type={ty} />
            </div>
            <figcaption className="caption">{t(`types.${ty}.name`)}</figcaption>
          </figure>
        ))}
      </div>
      <h1 className="title1 center">{t('explain.drainTitle')}</h1>
      <p className="subhead secondary center">{t('explain.drainText')}</p>
    </>
  );
}

export function ExplainWater() {
  return (
    <>
      <div className="cutaway-wrap">
        <DrainCutaway />
      </div>
      <h1 className="title1 center">{t('explain.waterTitle')}</h1>
      <p className="subhead secondary center">{t('explain.waterText')}</p>
      <p className="subhead center mission">{t('explain.mission')}</p>
    </>
  );
}
