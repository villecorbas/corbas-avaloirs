import { useEffect, useMemo, useState } from 'react';
import { buildLeaderboard } from '../lib/leaderboard';
import { LeaderboardScreen } from './LeaderboardScreen';
import { getConfig } from '../lib/config';
import { formatDate, formatRelative, t } from '../i18n';
import { Icon } from '../components/Icon';
import { Bar, Ring, Sheet, Spinner } from '../components/ui';
import { kvGet } from '../lib/db';
import { cachedCommuneStats, fetchCommuneStats, type CommuneStats } from '../lib/overpass';
import { useAuth, useOnline, useProgress } from '../lib/store';
import type { BadgeState } from '../lib/gamification';

export function useCommune() {
  const cfg = getConfig();
  const [commune, setCommune] = useState<{ insee: string; name?: string } | null>(cfg.commune.insee ? cfg.commune : null);
  useEffect(() => {
    if (commune) return;
    void kvGet<{ insee: string; name?: string }>('commune').then((c) => c && setCommune(c));
  }, [commune]);
  return commune;
}

export function ProfileScreen({ onConnect, onInvite, onShare, onCampaign }: { onConnect: () => void; onInvite: () => void; onShare: () => void; onCampaign: () => void }) {
  const progress = useProgress();
  const auth = useAuth();
  const online = useOnline();
  const commune = useCommune();
  const cfg = getConfig();
  const [stats, setStats] = useState<CommuneStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [badge, setBadge] = useState<BadgeState | null>(null);

  const refresh = async (insee: string) => {
    setLoading(true);
    setFailed(false);
    try {
      setStats(await fetchCommuneStats(insee));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!commune) return;
    void cachedCommuneStats(commune.insee).then((c) => {
      if (c) setStats(c);
      if (online && (!c || Date.now() - c.at > 15 * 60_000)) void refresh(commune.insee);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commune?.insee]);

  const lvl = progress.level;
  const unlockedCount = progress.badges.filter((b) => b.unlockedAt).length;
  const myName = auth.osm?.user?.name;
  const monthBoard = useMemo(() => (stats ? buildLeaderboard(stats.drains, { since: Date.now() - 30 * 86_400_000 }) : []), [stats]);
  const myEntry = myName ? monthBoard.find((e) => e.user === myName) : undefined;
  const [showBoard, setShowBoard] = useState(false);
  const communeName = commune?.name || cfg.commune.name;
  const target = cfg.commune.estimatedDrains;

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="large-title">{t('profile.title')}</h1>
      </header>

      <div className="card level-card">
        <Ring progress={lvl.progress} size={96} width={10} color="var(--accent)">
          <div className="center">
            <div className="caption secondary">{t('level.short')}</div>
            <div className="title1 rounded-num">{lvl.level}</div>
          </div>
        </Ring>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="title3">{t(`levels.${lvl.level}`)}</div>
          <div className="subhead secondary rounded-num">
            {progress.points} {t('common.pts')}
          </div>
          <div className="footnote secondary" style={{ marginTop: 6 }}>
            {lvl.max ? t('level.max') : t('level.toNextName', { points: lvl.next! - progress.points, name: t(`levels.${lvl.level + 1}`) })}
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <MiniStat icon="grate" color="var(--accent)" value={progress.count} label={t('profile.drains')} />
        <MiniStat icon="globe" color="var(--green)" value={progress.published} label={t('profile.published')} />
        <MiniStat icon="flame" color="var(--orange)" value={progress.streak} label={t('profile.streakDays', { count: progress.streak })} />
        <MiniStat icon="star" color="var(--yellow)" value={unlockedCount} label={t('profile.badges', { total: progress.badges.length })} />
      </div>

      <button className="card lb-entry" onClick={onCampaign}>
        <span className="lb-entry-icon" aria-hidden="true">🏘️</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span className="headline" style={{ display: 'block' }}>{t('campaign.card')}</span>
          <span className="footnote secondary">{t('campaign.cardText')}</span>
        </span>
        <Icon name="chevron" size={16} className="chev" />
      </button>

      <button className="card lb-entry" onClick={() => stats && setShowBoard(true)} disabled={!stats}>
        <span className="lb-entry-icon" aria-hidden="true">🏆</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span className="headline" style={{ display: 'block' }}>{t('leaderboard.title')}</span>
          <span className="footnote secondary">
            {!stats
              ? commune
                ? t('profile.loadingCommune')
                : t('profile.communeUnknown')
              : myEntry
                ? t(myEntry.rank === 1 ? 'leaderboard.entryFirst' : 'leaderboard.entryRank', { rank: myEntry.rank, total: monthBoard.length })
                : t('leaderboard.entryCount', { count: monthBoard.length })}
          </span>
        </span>
        <span className="lb-entry-avatars" aria-hidden="true">
          {monthBoard.slice(0, 3).map((e) => (
            <span key={e.user} className="lb-avatar" style={{ background: '#5e5ce6' }}>
              {e.user.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
        <Icon name="chevron" size={16} className="chev" />
      </button>

      <div className="social-row">
        <button className="card social-btn" onClick={onShare}>
          <span aria-hidden="true">📣</span>
          <span className="headline">{t('profile.shareScore')}</span>
          <span className="caption secondary">{t('profile.shareScoreHint')}</span>
        </button>
        <button className="card social-btn" onClick={onInvite}>
          <span aria-hidden="true">🤝</span>
          <span className="headline">{t('profile.invite')}</span>
          <span className="caption secondary">{t('profile.inviteHint')}</span>
        </button>
      </div>

      <h3 className="section-title">{t('profile.badgesTitle')}</h3>
      <div className="badges-grid">
        {progress.badges.map((b) => (
          <button key={b.def.id} className={`badge ${b.unlockedAt ? '' : 'locked'}`} onClick={() => setBadge(b)}>
            <span className="medal" style={{ background: b.unlockedAt ? `linear-gradient(135deg, ${b.def.colors[0]}, ${b.def.colors[1]})` : undefined }}>
              {b.def.icon}
            </span>
            <span className="caption badge-name">{t(`badges.${b.def.id}.name`)}</span>
            {!b.unlockedAt && b.def.target > 1 && (
              <span className="badge-progress">
                <Bar progress={b.value / b.def.target} height={4} />
              </span>
            )}
          </button>
        ))}
      </div>

      <h3 className="section-title">{communeName ? t('profile.communeTitle', { name: communeName }) : t('profile.communeTitleGeneric')}</h3>
      {!commune ? (
        <div className="card footnote secondary">{t('profile.communeUnknown')}</div>
      ) : (
        <div className="card stack">
          {stats ? (
            <>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <div className="title2 rounded-num">
                    {stats.total} <span className="subhead secondary">/ ~{target}</span>
                  </div>
                  <div className="footnote secondary">{t('profile.communeProgress')}</div>
                </div>
                <span className="chip accent">{Math.min(100, Math.round((stats.total / Math.max(1, target)) * 100))} %</span>
              </div>
              <Bar progress={stats.total / Math.max(1, target)} height={10} color="linear-gradient(90deg, var(--accent), var(--teal))" />
              <div className="footnote secondary">
                {t('profile.withPhoto', { count: stats.withPhoto })} · {t('profile.updated', { when: formatRelative(stats.at) })}
              </div>
            </>
          ) : loading ? (
            <div className="row">
              <Spinner /> <span className="subhead secondary">{t('profile.loadingCommune')}</span>
            </div>
          ) : (
            <div className="footnote secondary">{failed ? t('profile.communeFailed') : t('profile.communeOffline')}</div>
          )}
        </div>
      )}

      {commune && (
        <button className="btn plain" style={{ marginTop: 8 }} onClick={() => void refresh(commune.insee)} disabled={loading || !online}>
          <Icon name="sync" size={18} /> {t('profile.refresh')}
        </button>
      )}

      {showBoard && stats && (
        <LeaderboardScreen
          stats={stats}
          communeName={communeName}
          myName={myName}
          onClose={() => setShowBoard(false)}
          onConnect={() => {
            setShowBoard(false);
            onConnect();
          }}
        />
      )}

      <Sheet open={!!badge} onClose={() => setBadge(null)} elevated>
        {badge && (
          <div className="stack center" style={{ alignItems: 'center', paddingBottom: 8 }}>
            <span
              className={`medal big pop ${badge.unlockedAt ? '' : 'locked'}`}
              style={{ background: badge.unlockedAt ? `linear-gradient(135deg, ${badge.def.colors[0]}, ${badge.def.colors[1]})` : undefined }}
            >
              {badge.def.icon}
            </span>
            <h2 className="title2">{t(`badges.${badge.def.id}.name`)}</h2>
            <p className="subhead secondary" style={{ margin: 0 }}>{t(`badges.${badge.def.id}.desc`)}</p>
            {badge.unlockedAt ? (
              <span className="chip green">{t('profile.unlockedOn', { date: formatDate(badge.unlockedAt, { dateStyle: 'long' }) })}</span>
            ) : (
              <div style={{ width: '100%' }} className="stack">
                <Bar progress={badge.value / badge.def.target} />
                <span className="footnote secondary">
                  {badge.value} / {badge.def.target}
                </span>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function MiniStat({ icon, color, value, label }: { icon: 'grate' | 'globe' | 'flame' | 'star'; color: string; value: number; label: string }) {
  return (
    <div className="card mini-stat">
      <Icon name={icon} size={20} fill={icon === 'flame' || icon === 'star'} style={{ color }} />
      <span className="title2 rounded-num">{value}</span>
      <span className="caption secondary">{label}</span>
    </div>
  );
}
