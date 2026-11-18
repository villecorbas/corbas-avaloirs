import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatRelative, t } from '../i18n';
import { Icon } from '../components/Icon';
import { Segmented } from '../components/ui';
import { buildLeaderboard, POINTS_PER_DRAIN, POINTS_PER_PHOTO, type LeaderboardEntry } from '../lib/leaderboard';
import type { CommuneStats } from '../lib/overpass';

type Period = 'month' | 'all';
const MONTH = 30 * 86_400_000;
const AVATAR_COLORS = ['#ff9500', '#30b0c7', '#af52de', '#34c759', '#ff2d55', '#5856d6', '#00a588', '#ff6b6b'];

function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span className="lb-avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(name) }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Classement des participants de la commune (données publiques OpenStreetMap). */
export function LeaderboardScreen({
  stats,
  communeName,
  myName,
  onClose,
  onConnect,
}: {
  stats: CommuneStats;
  communeName?: string;
  myName?: string;
  onClose: () => void;
  onConnect: () => void;
}) {
  const [period, setPeriod] = useState<Period>('month');
  const board = useMemo(
    () => buildLeaderboard(stats.drains, period === 'month' ? { since: Date.now() - MONTH } : {}),
    [stats, period],
  );
  const me = myName ? board.find((e) => e.user === myName) : undefined;
  const podium = board.slice(0, 3);
  const rest = board.slice(3);

  return createPortal(
    <div className="wizard-modal lb" role="dialog" aria-modal="true" aria-label={t('leaderboard.title')}>
      <button className="icon-btn wizard-close" onClick={onClose} aria-label={t('common.close')}>
        <Icon name="close" stroke={2.4} />
      </button>
      <div className="lb-inner">
        <h1 className="large-title">{t('leaderboard.title')}</h1>
        <p className="subhead secondary" style={{ margin: '2px 0 14px' }}>
          {communeName ? t('leaderboard.subtitle', { name: communeName }) : t('leaderboard.subtitleGeneric')} ·{' '}
          {t('profile.updated', { when: formatRelative(stats.at) })}
        </p>

        <div className="card" style={{ padding: 8 }}>
          <Segmented<Period>
            label={t('leaderboard.period')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'month', label: t('leaderboard.month') },
              { value: 'all', label: t('leaderboard.all') },
            ]}
          />
        </div>

        {me ? (
          <div className="card row lb-me slide-in">
            <span className="lb-rank-big rounded-num">{me.rank}<sup>{me.rank === 1 ? t('leaderboard.first') : t('leaderboard.nth')}</sup></span>
            <div style={{ flex: 1 }}>
              <div className="headline">{t('leaderboard.yourRank')}</div>
              <div className="footnote secondary">{lineText(me)}</div>
            </div>
            <span className="lb-score rounded-num">{me.score}</span>
          </div>
        ) : (
          <button className="card row lb-me" style={{ width: '100%', textAlign: 'left' }} onClick={myName ? onClose : onConnect}>
            <Icon name="trophy" size={26} style={{ color: 'var(--orange)', flex: 'none' }} />
            <span className="footnote" style={{ flex: 1 }}>{myName ? t('leaderboard.notRanked') : t('leaderboard.notConnected')}</span>
            <Icon name="chevron" size={16} className="chev" />
          </button>
        )}

        {board.length === 0 ? (
          <div className="empty">
            <div className="empty-art">
              <Icon name="trophy" size={44} />
            </div>
            <p className="subhead secondary">{t('leaderboard.empty')}</p>
          </div>
        ) : (
          <>
            <div className="podium" aria-label={t('leaderboard.podium')}>
              {[podium[1], podium[0], podium[2]].map((e, i) =>
                e ? <PodiumStep key={e.user} entry={e} place={[2, 1, 3][i]} me={e.user === myName} /> : <div key={i} />,
              )}
            </div>
            {rest.length > 0 && (
              <div className="list">
                {rest.map((e) => (
                  <div key={e.user} className={`list-row ${e.user === myName ? 'me' : ''}`} style={{ ['--inset' as string]: '100px' }}>
                    <span className="rank rounded-num">{e.rank}</span>
                    <Avatar name={e.user} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="ellipsis" style={{ display: 'block', fontWeight: 500 }}>
                        {e.user}
                        {e.user === myName && <span className="chip accent" style={{ marginLeft: 6 }}>{t('profile.you')}</span>}
                      </span>
                      <span className="footnote secondary">{lineText(e)}</span>
                    </span>
                    <span className="lb-score rounded-num">{e.score}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <p className="section-footer">{t('leaderboard.rules', { drain: POINTS_PER_DRAIN, photo: POINTS_PER_PHOTO })}</p>
      </div>
    </div>,
    document.body,
  );
}

function PodiumStep({ entry, place, me }: { entry: LeaderboardEntry; place: number; me: boolean }) {
  return (
    <div className={`podium-step p${place} ${me ? 'me' : ''} pop`} style={{ animationDelay: `${(3 - place) * 0.12}s` }}>
      <span className="podium-medal" aria-hidden="true">{['🥇', '🥈', '🥉'][place - 1]}</span>
      <Avatar name={entry.user} size={place === 1 ? 60 : 48} />
      <span className="podium-name ellipsis">{entry.user}</span>
      <span className="podium-score rounded-num">
        {entry.score} <small>{t('common.pts')}</small>
      </span>
      <span className="podium-block rounded-num">{place}</span>
    </div>
  );
}

function lineText(e: LeaderboardEntry) {
  return `${t('leaderboard.drainsCount', { count: e.drains })} · ${t('leaderboard.photosCount', { count: e.photos })}`;
}
