import { useMemo, useState } from 'react';
import { getConfig } from '../lib/config';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { Bar, haptic, Segmented, Spinner, toast } from '../components/ui';
import { registerInvite } from '../components/inviteReward';
import { COMMIT_POINTS, MAX_POINT_STREETS, MAX_STREETS, setStreetChosen, useMyStreets } from '../lib/commitments';
import { channelLink, inviteUrl } from '../lib/invite';
import { streetKey, streetState } from '../lib/streets';
import { useOnline, useAuth } from '../lib/store';
import { useStreetProgress } from '../lib/useStreetProgress';
import { useCommune } from './ProfileScreen';

type Filter = 'all' | 'todo' | 'mine';

/**
 * « Mes rues à relever » : choisir une ou plusieurs rues de la commune, suivre leur avancement (engagement local).
 * `first` : étape du tout premier lancement (tunnel de gamification) : on cherche sa rue, +points à la clé.
 */
export function CampaignScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="wizard-modal" role="dialog" aria-modal="true" aria-label={t('campaign.title')}>
      <button className="icon-btn wizard-close" onClick={onClose} aria-label={t('common.close')}>
        <Icon name="close" stroke={2.4} />
      </button>
      <CampaignContent />
    </div>
  );
}

/** Contenu de l'écran ; `first` = version du tunnel d'accueil (intégrée à une page, sans fenêtre ni bouton de fermeture). */
export function CampaignContent({ first = false }: { first?: boolean }) {
  const commune = useCommune();
  const online = useOnline();
  const { osm } = useAuth();
  const mine = useMyStreets();
  const { progress, failed } = useStreetProgress(commune?.insee);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(40);

  const list = progress ?? [];
  const done = list.filter((p) => streetState(p) === 'done').length;
  const myRows = list.filter((p) => mine.includes(p.name));
  const needle = streetKey(query);
  const shown = useMemo(
    () =>
      (first && !needle ? [] : list)
        .filter((p) => (needle ? p.key.includes(needle) : true))
        .filter((p) => (filter === 'todo' ? streetState(p) !== 'done' : filter === 'mine' ? mine.includes(p.name) : true)),
    [list, needle, filter, mine, first],
  );

  const toggle = (name: string, on: boolean) => {
    const before = mine.length;
    setStreetChosen(name, on);
    if (on) {
      haptic('success');
      if (before < MAX_POINT_STREETS) toast(t('campaign.earned', { points: COMMIT_POINTS }), 'star', 'var(--orange)');
    }
  };

  const place = commune?.name || getConfig().commune.name;
  const shareUrl = (() => {
    const u = new URL(inviteUrl(osm?.user?.name));
    u.searchParams.set('rues', '1');
    return u.toString();
  })();
  const shareText = t('campaign.shareText', { streets: mine.join(', '), place: place ? t('invite.inPlace', { name: place }) : '' });
  const share = () => {
    if (typeof navigator.share === 'function') {
      void navigator
        .share({ title: getConfig().campaignName, text: shareText, url: shareUrl })
        .then(() => registerInvite('commitment'))
        .catch(() => undefined);
    }
  };

  return (
    <>
      <div className="wizard">
        <div className="wizard-art" aria-hidden="true" style={{ fontSize: 40 }}>
          🏘️
        </div>
        <h1 className="title1 center">{first ? t('campaign.firstTitle') : t('campaign.title')}</h1>
        <p className="subhead secondary center" style={{ margin: 0 }}>
          {first ? t('campaign.firstIntro') : t('campaign.intro')}
        </p>
        <div className="card row reward-banner">
          <span className="reward-star" aria-hidden="true">⭐</span>
          <span className="footnote" style={{ flex: 1 }}>{t('campaign.reward', { points: COMMIT_POINTS, max: MAX_POINT_STREETS })}</span>
        </div>

        {mine.length > 0 && !first && (
          <div className="card stack">
            <div className="headline">{t('campaign.mineTitle', { count: mine.length })}</div>
            {myRows.map((p) => (
              <div key={p.key} className="stack" style={{ gap: 4 }}>
                <div className="row footnote">
                  <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                  <span className="secondary">{streetState(p) === 'done' ? `✓ ${t('campaign.done')}` : p.ratio === null ? t('campaign.unknown') : `${Math.round(p.ratio * 100)} %`}</span>
                </div>
                {p.ratio !== null && <Bar progress={p.ratio} height={5} color={streetState(p) === 'done' ? 'var(--green)' : 'var(--accent)'} />}
              </div>
            ))}
            {typeof navigator.share === 'function' ? (
              <button className="btn" onClick={share}>
                <Icon name="share" /> {t('campaign.share')}
              </button>
            ) : (
              <a className="btn" href={channelLink('whatsapp', `${shareText} ${shareUrl}`, '')} target="_blank" rel="noopener noreferrer" onClick={() => registerInvite('commitment')}>
                <Icon name="share" /> {t('campaign.share')}
              </a>
            )}
          </div>
        )}

        {progress && !first && (
          <div className="card stack">
            <div className="row footnote">
              <span style={{ fontWeight: 600 }}>{t('campaign.summary', { done, total: list.length })}</span>
            </div>
            <Bar progress={list.length ? done / list.length : 0} color="linear-gradient(90deg, var(--accent), var(--teal))" />
          </div>
        )}

        <input
          className="text-input"
          type="search"
          inputMode="search"
          placeholder={t('campaign.search')}
          aria-label={t('campaign.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(40);
          }}
        />
        {!first && (
        <Segmented<Filter>
          label={t('campaign.filter')}
          value={filter}
          onChange={setFilter}
          options={(['all', 'todo', 'mine'] as Filter[]).map((f) => ({ value: f, label: t(`campaign.filter_${f}`) }))}
        />
        )}

        {!progress && !failed && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner size={28} />
            <p className="footnote secondary">{t('campaign.loading')}</p>
          </div>
        )}
        {failed && (
          <div className="card row">
            <Icon name="warning" style={{ color: 'var(--orange)', flex: 'none' }} />
            <span className="footnote">{online ? t('campaign.failed') : t('campaign.offline')}</span>
          </div>
        )}
        {progress && first && !needle && <p className="footnote secondary center">{t('campaign.typeHint')}</p>}
        {progress && !shown.length && (!first || needle) && <p className="subhead secondary center">{t('campaign.none')}</p>}

        <ul className="street-list">
          {shown.slice(0, limit).map((p) => {
            const state = streetState(p);
            const chosen = mine.includes(p.name);
            return (
              <li key={p.key} className={`card street-row ${chosen ? 'chosen' : ''}`}>
                <div className="row" style={{ alignItems: 'baseline' }}>
                  <span className="headline" style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                  {state === 'unknown' ? (
                    <span className="chip">{t('campaign.unknown')}</span>
                  ) : (
                    <span className={`chip ${state === 'done' ? 'green' : ''}`}>{state === 'done' ? `✓ ${t('campaign.done')}` : `${Math.round((p.ratio ?? 0) * 100)} %`}</span>
                  )}
                </div>
                {p.ratio !== null && <Bar progress={p.ratio} height={6} color={state === 'done' ? 'var(--green)' : 'var(--accent)'} />}
                {(state !== 'done' || chosen) && (
                  <div className="row footnote secondary" style={{ justifyContent: 'flex-end' }}>
                    <button
                      className={`btn small ${chosen ? '' : 'tinted'}`}
                      aria-pressed={chosen}
                      disabled={!chosen && mine.length >= MAX_STREETS}
                      onClick={() => toggle(p.name, !chosen)}
                    >
                      {chosen ? `✓ ${t('campaign.chosen')}` : t('campaign.choose')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {shown.length > limit && (
          <button className="btn gray" onClick={() => setLimit(limit + 40)}>
            {t('campaign.more', { count: shown.length - limit })}
          </button>
        )}
        <p className="section-footer center">{t('campaign.local')}</p>
      </div>
    </>
  );
}
