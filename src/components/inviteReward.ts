import { t } from '../i18n';
import { haptic, toast } from './ui';
import { logInvite } from '../lib/inviteLog';

/** Enregistre une invitation envoyée et félicite (ou explique le plafond atteint). */
export function registerInvite(channel: string) {
  const r = logInvite(channel);
  if (r.counted) {
    haptic('success');
    toast(t('invite.earned', { points: r.points }), 'star', 'var(--orange)');
  } else if (r.reason === 'daily') toast(t('invite.dailyCap'), 'check');
  else if (r.reason === 'total') toast(t('invite.totalCap'), 'check');
  return r;
}
