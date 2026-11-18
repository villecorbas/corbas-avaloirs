import { useEffect, useMemo, useState } from 'react';
import { getConfig } from '../lib/config';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { Spinner, toast } from '../components/ui';
import { download } from '../lib/export';
import { inviteUrl, networkLink, renderScoreCard, type Network } from '../lib/invite';
import { buildLeaderboard } from '../lib/leaderboard';
import { cachedCommuneStats } from '../lib/overpass';
import { useAuth, useProgress } from '../lib/store';
import { useCommune } from './ProfileScreen';

const NETWORKS: { id: Network; label: string; color: string; glyph: string }[] = [
  { id: 'facebook', label: 'Facebook', color: '#1877f2', glyph: 'f' },
  { id: 'whatsapp', label: 'WhatsApp', color: '#25d366', glyph: '💬' },
  { id: 'x', label: 'X', color: '#000000', glyph: '𝕏' },
  { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2', glyph: 'in' },
  { id: 'bluesky', label: 'Bluesky', color: '#1185fe', glyph: '🦋' },
];

/** Page « Partager mon score » : carte image + réseaux sociaux, avec lien pour rejoindre. */
export function ShareScoreScreen({ onClose }: { onClose: () => void }) {
  const progress = useProgress();
  const { osm } = useAuth();
  const commune = useCommune();
  const pseudo = osm?.user?.name;
  const url = inviteUrl(pseudo);
  const place = commune?.name || getConfig().commune.name;
  const [rank, setRank] = useState<string>();
  const [png, setPng] = useState<Blob | null>(null);
  const preview = useMemo(() => (png ? URL.createObjectURL(png) : null), [png]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // Rang du mois dans la commune (si les statistiques sont en cache).
  useEffect(() => {
    if (!commune || !pseudo) return;
    void cachedCommuneStats(commune.insee).then((s) => {
      if (!s) return;
      const board = buildLeaderboard(s.drains, { since: Date.now() - 30 * 86_400_000 });
      const me = board.find((e) => e.user === pseudo);
      if (me) setRank(t('share2.rank', { rank: me.rank, total: board.length }));
    });
  }, [commune, pseudo]);

  const badges = progress.badges.filter((b) => b.unlockedAt).map((b) => b.def.icon);
  const text = t('share2.text', { count: progress.count, place: place ? t('invite.inPlace', { name: place }) : '' });

  useEffect(() => {
    let alive = true;
    void renderScoreCard({
      title: t('share2.cardTitle', { count: progress.count }),
      subtitle: [pseudo, place].filter(Boolean).join(' · ') || t('share2.cardSubtitle'),
      drains: progress.count,
      drainsLabel: t('share2.drains', { count: progress.count }),
      points: progress.points,
      pointsLabel: t('share2.points'),
      level: `${t('level.label', { level: progress.level.level })} · ${t(`levels.${progress.level.level}`)}`,
      rank,
      badges,
      cta: t('share2.cta'),
      url,
    }).then((b) => alive && setPng(b));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.count, progress.points, rank, pseudo, place]);

  const file = png ? new File([png], 'chasse-aux-avaloirs.png', { type: 'image/png' }) : null;
  const canShareFile = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  return (
    <div className="wizard-modal" role="dialog" aria-modal="true" aria-label={t('share2.title')}>
      <button className="icon-btn wizard-close" onClick={onClose} aria-label={t('common.close')}>
        <Icon name="close" stroke={2.4} />
      </button>
      <div className="wizard">
        <h1 className="title1 center">{t('share2.title')}</h1>
        <p className="subhead secondary center" style={{ margin: 0 }}>
          {t('share2.intro')}
        </p>
        <div className="score-card-preview">{preview ? <img src={preview} alt={t('share2.previewAlt')} /> : <Spinner size={28} />}</div>

        {canShareFile ? (
          <button
            className="btn"
            onClick={() => void navigator.share({ files: [file!], text: `${text} ${url}` }).catch(() => undefined)}
          >
            <Icon name="share" /> {t('share2.shareImage')}
          </button>
        ) : (
          <button className="btn" disabled={!png} onClick={() => png && download('chasse-aux-avaloirs.png', png, 'image/png')}>
            <Icon name="download" /> {t('share2.download')}
          </button>
        )}

        <h3 className="section-title">{t('share2.networks')}</h3>
        <div className="share-networks">
          {NETWORKS.map((n) => (
            <a key={n.id} className="share-network" href={networkLink(n.id, text, url)} target="_blank" rel="noopener">
              <span className="invite-glyph" style={{ background: n.color }} aria-hidden="true">
                {n.glyph}
              </span>
              <span className="caption">{n.label}</span>
            </a>
          ))}
        </div>
        <p className="section-footer">{t('share2.instagram')}</p>
        <button className="btn gray" onClick={() => void navigator.clipboard?.writeText(`${text} ${url}`).then(() => toast(t('share.copied'), 'check'))}>
          {t('invite.copy')}
        </button>
      </div>
    </div>
  );
}
