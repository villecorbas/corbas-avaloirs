import { t } from '../i18n';
import { Icon } from './Icon';

/**
 * Rappels gamifiés pour les contributeurs sans compte OpenStreetMap : leurs relevés
 * restent sur le téléphone et les points de publication sont « verrouillés ».
 */

/** Bandeau de la carte. */
export function LockedBanner({ count, points, onConnect }: { count: number; points: number; onConnect: () => void }) {
  return (
    <button className="locked-banner slide-in" onClick={onConnect}>
      <span className="locked-icon" aria-hidden="true">
        <Icon name="lock" size={18} stroke={2.2} />
      </span>
      <span className="locked-text">
        <strong>{t('locked.bannerTitle', { count })}</strong>
        <span>{t('locked.bannerText', { points })}</span>
      </span>
      <Icon name="chevron" size={16} />
    </button>
  );
}

/** Carte d'alerte de l'écran de victoire. */
export function LockedCard({ count, points, onConnect, first }: { count: number; points: number; onConnect: () => void; first?: boolean }) {
  return (
    <div className="card locked-card pop" style={{ marginTop: 16, animationDelay: '.5s' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="locked-icon big" aria-hidden="true">
          <Icon name="lock" size={22} stroke={2.2} />
        </span>
        <div style={{ flex: 1 }}>
          <div className="headline">{t(first ? 'locked.firstTitle' : 'locked.cardTitle')}</div>
          <div className="footnote secondary">{first ? t('locked.firstText') : t('locked.cardText', { count })}</div>
        </div>
      </div>
      <div className="locked-points rounded-num">
        🔒 +{points} {t('common.pts')} <span>{t('locked.toUnlock')}</span>
      </div>
      <button className="btn" onClick={onConnect}>
        {t(first ? 'locked.firstConnect' : 'locked.connect')}
      </button>
      {first && <p className="footnote secondary center" style={{ margin: 0 }}>{t('locked.firstLeaving')}</p>}
    </div>
  );
}

/** Contenu de la fenêtre de rappel (ouverture de l'appli). */
export function LockedNudge({ count, points, onConnect, onLater }: { count: number; points: number; onConnect: () => void; onLater: () => void }) {
  return (
    <div className="stack center" style={{ alignItems: 'center' }}>
      <span className="locked-hero pop" aria-hidden="true">
        <Icon name="cloudUp" size={40} stroke={1.8} />
        <span className="locked-hero-badge">
          <Icon name="lock" size={16} stroke={2.4} />
        </span>
      </span>
      <h2 className="title2">{t('locked.nudgeTitle')}</h2>
      <p className="subhead secondary" style={{ margin: 0 }}>
        {t('locked.nudgeText', { count })}
      </p>
      <div className="locked-stats">
        <div>
          <span className="title2 rounded-num">{count}</span>
          <span className="caption secondary">{t('locked.statDrains', { count })}</span>
        </div>
        <div>
          <span className="title2 rounded-num" style={{ color: 'var(--orange)' }}>+{points}</span>
          <span className="caption secondary">{t('locked.statPoints')}</span>
        </div>
        <div>
          <span className="title2">🌍</span>
          <span className="caption secondary">{t('locked.statBadge')}</span>
        </div>
      </div>
      <button className="btn" onClick={onConnect}>
        {t('locked.connect')}
      </button>
      <button className="btn plain" onClick={onLater}>
        {t('wizard.later')}
      </button>
    </div>
  );
}

/** Rappel après le deuxième avaloir : inviter ses voisins rapporte des points. */
export function InviteCard({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="card invite-card pop" style={{ marginTop: 16, animationDelay: '.6s' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="reward-star big" aria-hidden="true">🤝</span>
        <div style={{ flex: 1 }}>
          <div className="headline">{t('inviteCard.title')}</div>
          <div className="footnote secondary">{t('inviteCard.text')}</div>
        </div>
      </div>
      <div className="locked-points rounded-num" style={{ color: 'var(--blue)', background: 'color-mix(in srgb, var(--blue) 12%, transparent)' }}>
        ⭐ +5 {t('common.pts')} <span>{t('inviteCard.perInvite')}</span>
      </div>
      <button className="btn" onClick={onInvite}>
        {t('inviteCard.button')}
      </button>
    </div>
  );
}
