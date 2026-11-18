import type { DrainType } from '../lib/taxonomy';

/**
 * Illustrations vectorielles des types d'avaloirs : trottoir, bordure, caniveau
 * et chaussée vus de trois-quarts, pour que chacun reconnaisse ce qu'il a sous les yeux.
 */

function Scene({ children, kerb = true }: { children: React.ReactNode; kerb?: boolean }) {
  return (
    <>
      <rect x="0" y="0" width="160" height="40" fill="var(--ill-sidewalk)" />
      <path d="M0 13h160M0 27h160M40 0v13M100 0v13M70 13v14M130 13v14M20 27v13M85 27v13M145 27v13" stroke="var(--ill-joint)" strokeWidth="1" />
      {kerb && (
        <>
          <rect x="0" y="38" width="160" height="7" fill="var(--ill-kerb)" />
          <rect x="0" y="45" width="160" height="8" fill="var(--ill-kerb-face)" />
        </>
      )}
      <rect x="0" y="53" width="160" height="13" fill="var(--ill-gutter)" />
      <rect x="0" y="66" width="160" height="44" fill="var(--ill-road)" />
      <path d="M0 66h160" stroke="var(--ill-joint)" strokeWidth="1" />
      {children}
    </>
  );
}

function Slots({ x, y, w, h, n, vertical = true }: { x: number; y: number; w: number; h: number; n: number; vertical?: boolean }) {
  const items = [];
  if (vertical) {
    const gap = w / n;
    for (let i = 0; i < n; i++) {
      items.push(<rect key={i} x={x + i * gap + gap * 0.25} y={y} width={gap * 0.5} height={h} rx={1.2} fill="var(--ill-hole)" />);
    }
  } else {
    const gap = h / n;
    for (let i = 0; i < n; i++) {
      items.push(<rect key={i} x={x} y={y + i * gap + gap * 0.25} width={w} height={gap * 0.5} rx={1.2} fill="var(--ill-hole)" />);
    }
  }
  return <>{items}</>;
}

function Water() {
  return <path d="M18 92c8-3 16 3 24 0s16-3 24 0" stroke="var(--ill-water)" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity=".7" />;
}

const ILLUSTRATIONS: Record<DrainType, () => React.ReactElement> = {
  grate: () => (
    <Scene>
      <rect x="54" y="72" width="54" height="28" rx="2.5" fill="var(--ill-metal)" />
      <rect x="57" y="75" width="48" height="22" rx="1.5" fill="var(--ill-metal-dark)" />
      <Slots x={58} y={77} w={46} h={18} n={8} />
      <Water />
    </Scene>
  ),
  kerb_grate: () => (
    <Scene>
      <rect x="50" y="36" width="60" height="9" rx="1.5" fill="var(--ill-metal)" />
      <rect x="50" y="45" width="60" height="8" fill="var(--ill-metal-dark)" />
      <rect x="54" y="46.5" width="52" height="4.5" rx="2" fill="var(--ill-hole)" />
      <rect x="50" y="53" width="60" height="25" rx="1.5" fill="var(--ill-metal)" />
      <rect x="53" y="56" width="54" height="19" rx="1" fill="var(--ill-metal-dark)" />
      <Slots x={54} y={57.5} w={52} h={16} n={9} />
    </Scene>
  ),
  kerb_opening: () => (
    <Scene>
      <rect x="58" y="12" width="44" height="22" rx="2" fill="none" stroke="var(--ill-metal)" strokeWidth="2" strokeDasharray="4 3" />
      <rect x="40" y="38" width="80" height="7" fill="var(--ill-kerb-cast)" />
      <rect x="40" y="45" width="80" height="8" fill="var(--ill-kerb-face)" />
      <path d="M44 46.5h72l-4 6H48z" fill="var(--ill-hole)" />
      <path d="M44 53h72v4H44z" fill="var(--ill-gutter-dark)" />
      <path d="M40 74c10 2 20-1 30 1" stroke="var(--ill-water)" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity=".6" />
    </Scene>
  ),
  channel: () => (
    <Scene>
      <rect x="8" y="78" width="144" height="13" rx="2" fill="var(--ill-metal)" />
      <rect x="10" y="80" width="140" height="9" rx="1" fill="var(--ill-metal-dark)" />
      <Slots x={11} y={81} w={138} h={7} n={23} />
    </Scene>
  ),
  generic: () => (
    <Scene>
      <circle cx="80" cy="86" r="19" fill="var(--ill-metal)" />
      <circle cx="80" cy="86" r="15.5" fill="var(--ill-metal-dark)" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2;
        return <circle key={i} cx={80 + Math.cos(a) * 10} cy={86 + Math.sin(a) * 10} r="2.4" fill="var(--ill-hole)" />;
      })}
      <circle cx="80" cy="86" r="3" fill="var(--ill-hole)" />
      <circle cx="118" cy="76" r="11" fill="var(--accent)" />
      <text x="118" y="81" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--on-accent)" fontFamily="var(--font-rounded)">?</text>
    </Scene>
  ),
};

export function DrainIllustration({ type, className }: { type: DrainType; className?: string }) {
  const Draw = ILLUSTRATIONS[type];
  return (
    <svg viewBox="0 0 160 110" className={`illu ${className || ''}`} role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <Draw />
    </svg>
  );
}
