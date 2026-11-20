import { useEffect, useMemo, useState } from 'react';
import { getConfig } from '../../lib/config';
import { t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { Bar, Confetti, CountUp, Ring } from '../../components/ui';
import { InviteCard, LockedCard, PledgeCard } from '../../components/LockedReminder';
import { invitePromptDue, lastInvitePrompt, markInvitePrompt } from '../../lib/inviteLog';
import type { BadgeState, PointLine, Progress } from '../../lib/gamification';
import { panoramaxReady } from '../../lib/panoramax';
import { getOsmAuth } from '../../lib/osm';

export function SuccessStep({
  points,
  before,
  after,
  unlocked,
  onAnother,
  onFinish,
  onConnect,
  onInvite,
  onCampaign,
}: {
  points: { total: number; lines: PointLine[] };
  before: Progress;
  after: Progress;
  unlocked: BadgeState[];
  onAnother: () => void;
  onFinish: () => void;
  onConnect: () => void;
  onInvite: () => void;
  onCampaign: () => void;
}) {
  const goal = getConfig().dailyGoal;
  const levelUp = after.level.level > before.level.level;
  const connected = !!getOsmAuth() && panoramaxReady();
  // Rappel unique après le deuxième avaloir, tant qu'aucune invitation n'a été envoyée.
  const [inviteMilestone] = useState(() => invitePromptDue(after.count, after.invites, lastInvitePrompt()));
  const showInvite = inviteMilestone !== null;
  useEffect(() => {
    if (inviteMilestone !== null) markInvitePrompt(inviteMilestone);
  }, [inviteMilestone]);
  const [detail, setDetail] = useState(false);
  const cheer = useMemo(() => {
    const list = t('success.cheers').split('|');
    return list[Math.floor(Math.random() * list.length)];
  }, []);

  return (
    <div className="success">
      <Confetti run />
      <div className="success-content">
      <div className="success-check pop">
        <svg viewBox="0 0 96 96" aria-hidden="true">
          <circle cx="48" cy="48" r="44" fill="var(--accent)" />
          <path className="draw-check" d="m29 49 13 13 26-28" stroke="var(--on-accent)" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="large-title center">{cheer}</h1>
      <p className="subhead secondary center" style={{ margin: '4px 0 18px' }}>{t('success.saved')}</p>

      <div className="points-burst rounded-num pop" style={{ animationDelay: '.15s' }}>
        +<CountUp value={points.total} /> <span>{t('common.pts')}</span>
      </div>
      {points.lines.length > 1 && (
        <button className="btn plain small" aria-expanded={detail} onClick={() => setDetail(!detail)}>
          {detail ? t('success.hideDetail') : t('success.showDetail')}
        </button>
      )}
      {detail && (
        <div className="points-lines">
          {points.lines.map((l) => (
            <span key={l.key} className="chip">
              {t(`points.${l.key}`)} +{l.points}
            </span>
          ))}
        </div>
      )}

      {levelUp && (
        <div className="card row pop levelup" style={{ marginTop: 16, animationDelay: '.3s' }}>
          <span style={{ fontSize: 30 }}>🎉</span>
          <div>
            <div className="headline">{t('success.levelUp', { level: after.level.level })}</div>
            <div className="footnote secondary">{t(`levels.${after.level.level}`)}</div>
          </div>
        </div>
      )}

      {unlocked.map((b, i) => (
        <div key={b.def.id} className="card row pop" style={{ marginTop: 16, animationDelay: `${0.4 + i * 0.15}s` }}>
          <span className="medal" style={{ background: `linear-gradient(135deg, ${b.def.colors[0]}, ${b.def.colors[1]})` }}>
            {b.def.icon}
          </span>
          <div>
            <div className="caption secondary" style={{ textTransform: 'uppercase', fontWeight: 600 }}>{t('success.newBadge')}</div>
            <div className="headline">{t(`badges.${b.def.id}.name`)}</div>
            <div className="footnote secondary">{t(`badges.${b.def.id}.desc`)}</div>
          </div>
        </div>
      ))}

      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="row">
          <Ring progress={Math.min(1, after.today / goal)} size={56} width={7} color="var(--orange)">
            <span className="footnote rounded-num" style={{ fontWeight: 700 }}>
              {after.today}/{goal}
            </span>
          </Ring>
          <div style={{ flex: 1 }}>
            <div className="headline">{after.today >= goal ? t('success.goalReached') : t('success.goal', { left: goal - after.today })}</div>
            <div className="footnote secondary">
              {after.streak > 1 ? t('success.streak', { count: after.streak }) : t('success.streakStart')}
            </div>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row footnote">
            <span style={{ fontWeight: 600 }}>
              {t('level.label', { level: after.level.level })} · {t(`levels.${after.level.level}`)}
            </span>
            <span className="secondary" style={{ marginLeft: 'auto' }}>
              {after.level.max ? t('level.max') : t('level.toNext', { points: after.level.next! - after.points })}
            </span>
          </div>
          <Bar progress={after.level.progress} color="linear-gradient(90deg, var(--accent), var(--teal))" />
        </div>
      </div>

      {!getOsmAuth() && after.unsent > 0 ? (
        <LockedCard count={after.unsent} points={after.lockedPoints} onConnect={onConnect} first={after.count === 1} />
      ) : !connected ? (
        <button className="card row" style={{ marginTop: 12, width: '100%', textAlign: 'left' }} onClick={onConnect}>
          <Icon name="cloudUp" style={{ color: 'var(--blue)', flex: 'none' }} />
          <span className="footnote" style={{ flex: 1 }}>{t('success.connectHint')}</span>
          <Icon name="chevron" size={16} className="chev" />
        </button>
      ) : null}

      {(after.count === 1 || after.count === 3) && after.commitments === 0 && <PledgeCard onPledge={onCampaign} />}

      {showInvite && <InviteCard onInvite={onInvite} count={after.count} />}

      </div>
      <div className="success-actions">
        <button className="btn" onClick={onAnother}>
          <Icon name="plus" stroke={2.6} /> {t('success.another')}
        </button>
        <button className="btn plain" onClick={onFinish}>
          {t('success.finish')}
        </button>
      </div>
    </div>
  );
}
