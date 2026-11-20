import qrcode from 'qrcode-generator';
import { appBaseUrl, getConfig } from './config';
import { platform } from './store';

const REF_KEY = 'avaloirs.invitedBy';

/** Lien d'invitation, signé du pseudonyme de l'invitant (accueil personnalisé). */
export function inviteUrl(pseudo?: string): string {
  const url = new URL(appBaseUrl());
  if (pseudo) url.searchParams.set('ref', pseudo);
  return url.toString();
}

/**
 * Le pseudonyme vient d'un lien : valeur non fiable, affichée à l'écran. On retire les
 * caractères de contrôle et de direction (usurpation visuelle) et on limite la longueur.
 */
export function cleanPseudo(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim()
    .slice(0, 40);
}

/** Au démarrage : mémorise « invité par … » et nettoie l'URL. */
export function captureReferral() {
  try {
    const url = new URL(window.location.href);
    const ref = cleanPseudo(url.searchParams.get('ref'));
    if (!ref) return;
    localStorage.setItem(REF_KEY, ref);
    url.searchParams.delete('ref');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

const CAMPAIGN_KEY = 'avaloirs.openCampaign';

/** Lien de campagne « …/?rues » : mémorise l'intention (l'accueil peut venir d'abord) et nettoie l'URL. */
export function captureCampaignLink() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('rues')) return;
    localStorage.setItem(CAMPAIGN_KEY, '1');
    url.searchParams.delete('rues');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

/** Vrai une seule fois après un lien de campagne. */
export function consumeCampaignLink(): boolean {
  try {
    if (localStorage.getItem(CAMPAIGN_KEY) !== '1') return false;
    localStorage.removeItem(CAMPAIGN_KEY);
    return true;
  } catch {
    return false;
  }
}

export function invitedBy(): string | null {
  try {
    return cleanPseudo(localStorage.getItem(REF_KEY)) || null;
  } catch {
    return null;
  }
}

export type Channel = 'whatsapp' | 'sms' | 'email';

/** Lien d'envoi direct vers WhatsApp, l'application SMS ou la messagerie. */
export function channelLink(channel: Channel, text: string, subject: string): string {
  const enc = encodeURIComponent;
  switch (channel) {
    case 'whatsapp':
      return `https://wa.me/?text=${enc(text)}`;
    case 'sms':
      // iOS attend « sms:&body= », Android « sms:?body= ».
      return platform() === 'ios' ? `sms:&body=${enc(text)}` : `sms:?body=${enc(text)}`;
    case 'email':
      return `mailto:?subject=${enc(subject)}&body=${enc(text)}`;
  }
}

export type Network = 'facebook' | 'x' | 'linkedin' | 'bluesky' | 'whatsapp';

/** Liens de partage des réseaux sociaux (sans SDK ni traceur). */
export function networkLink(network: Network, text: string, url: string): string {
  const enc = encodeURIComponent;
  switch (network) {
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`;
    case 'x':
      return `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`;
    case 'bluesky':
      return `https://bsky.app/intent/compose?text=${enc(`${text} ${url}`)}`;
    case 'whatsapp':
      return `https://wa.me/?text=${enc(`${text} ${url}`)}`;
  }
}

export function qrSvg(url: string, cellSize = 6): string {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}

/* --------------------------- Carte de score (image) ---------------------------- */

export interface ScoreCardData {
  title: string;
  subtitle: string;
  drains: number;
  drainsLabel: string;
  points: number;
  pointsLabel: string;
  level: string;
  rank?: string;
  badges: string[];
  cta: string;
  url: string;
}

/** Dessine une carte 1080×1350 (format portrait des réseaux sociaux) et renvoie un PNG. */
export async function renderScoreCard(d: ScoreCardData): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const font = (w: number, s: number) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#19c2a2');
  bg.addColorStop(1, '#00594b');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Motif discret de grille d'avaloir
  g.globalAlpha = 0.08;
  g.fillStyle = '#fff';
  for (let i = 0; i < 9; i++) g.fillRect(760 + i * 34, -40, 16, 420);
  g.globalAlpha = 1;

  g.fillStyle = '#fff';
  g.font = font(700, 40);
  g.fillText(getConfig().campaignName, 80, 120);
  g.globalAlpha = 0.85;
  g.font = font(500, 32);
  g.fillText(d.subtitle, 80, 170);
  g.globalAlpha = 1;

  g.font = font(800, 64);
  wrap(g, d.title, 80, 290, W - 160, 76);

  // Chiffres clés
  const card = (x: number, y: number, w: number, value: string, label: string) => {
    g.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(g, x, y, w, 230, 36);
    g.fill();
    g.fillStyle = '#fff';
    g.font = font(800, 110);
    g.fillText(value, x + 40, y + 135);
    g.globalAlpha = 0.85;
    g.font = font(600, 34);
    g.fillText(label, x + 42, y + 190);
    g.globalAlpha = 1;
  };
  card(80, 470, 440, String(d.drains), d.drainsLabel);
  card(560, 470, 440, String(d.points), d.pointsLabel);

  g.fillStyle = '#fff';
  g.font = font(700, 44);
  g.fillText(`🏅 ${d.level}`, 80, 800);
  if (d.rank) {
    g.font = font(600, 38);
    g.fillText(`🏆 ${d.rank}`, 80, 865);
  }
  if (d.badges.length) {
    g.font = font(400, 64);
    g.fillText(d.badges.slice(0, 8).join(' '), 80, 970);
  }

  // Pied : invitation + QR code
  g.fillStyle = '#ffffff';
  roundRect(g, 60, 1050, W - 120, 240, 36);
  g.fill();
  g.fillStyle = '#00594b';
  g.font = font(800, 42);
  wrap(g, d.cta, 110, 1130, 640, 52);
  g.font = font(500, 28);
  g.fillStyle = '#3c3c43';
  g.fillText(d.url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''), 110, 1250);
  const qr = qrcode(0, 'M');
  qr.addData(d.url);
  qr.make();
  const n = qr.getModuleCount();
  const size = 200;
  const cell = size / n;
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect(820 + col * cell, 1070 + r * cell, cell + 0.5, cell + 0.5);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > max && line) {
      g.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
}
