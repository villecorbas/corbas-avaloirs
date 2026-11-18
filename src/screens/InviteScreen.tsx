import { useMemo } from 'react';
import { getConfig } from '../lib/config';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { haptic, toast } from '../components/ui';
import { channelLink, inviteUrl, qrSvg, type Channel } from '../lib/invite';
import { useAuth } from '../lib/store';
import { useCommune } from './ProfileScreen';

const CHANNELS: { id: Channel; color: string; glyph: string }[] = [
  { id: 'whatsapp', color: '#25d366', glyph: '💬' },
  { id: 'sms', color: '#34c759', glyph: '✉️' },
  { id: 'email', color: '#007aff', glyph: '📧' },
];

/** Page « Inviter mes proches » : WhatsApp, SMS, e-mail, partage natif, lien et QR code. */
export function InviteScreen({ onClose }: { onClose: () => void }) {
  const { osm } = useAuth();
  const commune = useCommune();
  const pseudo = osm?.user?.name;
  const url = inviteUrl(pseudo);
  const place = commune?.name || getConfig().commune.name;
  const text = t('invite.message', { place: place ? t('invite.inPlace', { name: place }) : '', url });
  const subject = t('invite.subject');
  const svg = useMemo(() => qrSvg(url), [url]);

  return (
    <div className="wizard-modal" role="dialog" aria-modal="true" aria-label={t('invite.title')}>
      <button className="icon-btn wizard-close" onClick={onClose} aria-label={t('common.close')}>
        <Icon name="close" stroke={2.4} />
      </button>
      <div className="wizard">
        <div className="wizard-art" aria-hidden="true" style={{ fontSize: 40 }}>
          🤝
        </div>
        <h1 className="title1 center">{t('invite.title')}</h1>
        <p className="subhead secondary center" style={{ margin: 0 }}>
          {t('invite.intro')}
        </p>

        <div className="invite-channels">
          {CHANNELS.map((c) => (
            <a key={c.id} className="invite-channel" href={channelLink(c.id, text, subject)} target={c.id === 'whatsapp' ? '_blank' : undefined} rel="noopener" onClick={() => haptic()}>
              <span className="invite-glyph" style={{ background: c.color }} aria-hidden="true">
                {c.glyph}
              </span>
              <span>{t(`invite.${c.id}`)}</span>
            </a>
          ))}
        </div>

        {'share' in navigator && (
          <button
            className="btn"
            onClick={() => void navigator.share({ title: getConfig().campaignName, text: text.replace(url, '').trim(), url }).catch(() => undefined)}
          >
            <Icon name="share" /> {t('invite.otherApps')}
          </button>
        )}

        <h3 className="section-title">{t('invite.messageTitle')}</h3>
        <div className="card footnote selectable" style={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </div>
        <button className="btn gray" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast(t('share.copied'), 'check'))}>
          {t('invite.copy')}
        </button>

        <h3 className="section-title">{t('invite.qrTitle')}</h3>
        <div className="stack center" style={{ alignItems: 'center' }}>
          <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="footnote secondary" style={{ margin: 0 }}>{t('invite.qrText')}</p>
        </div>
        {pseudo && <p className="section-footer center">{t('invite.signed', { name: pseudo })}</p>}
      </div>
    </div>
  );
}
