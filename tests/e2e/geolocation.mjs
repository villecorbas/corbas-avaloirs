// Pannes de géolocalisation (position introuvable, refus puis réglage corrigé, GPS précis en échec,
// capteur muet) : l'application ne doit jamais tourner indéfiniment. Usage : npm run build && npm run e2e:geo
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeFakeCamera } from './fake-camera.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const Y4M = root + 'tests/e2e/.cache/drain.y4m';
const SHOTS = root + 'docs/screenshots/';
mkdirSync(SHOTS, { recursive: true });
mkdirSync(root + 'tests/e2e/.cache', { recursive: true });
const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}/`;
let fails = 0;
const check = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) fails++; };

// Géolocalisation simulée et pilotable : mode = 'ok' | 'denied' | 'unavailable' | 'highFails' | 'silent'
const MOCK = () => {
  window.__geo = { mode: 'unavailable', calls: [] };
  const pos = () => ({ coords: { latitude: 45.7499, longitude: 4.8422, accuracy: 6, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
  let id = 0;
  const run = (ok, err, o) => {
    const g = window.__geo;
    g.calls.push(o && o.enableHighAccuracy ? 'high' : 'low');
    const m = g.mode;
    setTimeout(() => {
      if (m === 'ok') ok(pos());
      else if (m === 'denied') err({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 });
      else if (m === 'unavailable') err({ code: 2, message: 'Position unavailable', PERMISSION_DENIED: 1 });
      else if (m === 'highFails') (o && o.enableHighAccuracy) ? err({ code: 3, message: 'Timeout expired', PERMISSION_DENIED: 1 }) : ok(pos());
      // 'silent' : aucune réponse
    }, 60);
  };
  navigator.geolocation.watchPosition = (ok, err, o) => { run(ok, err, o); return ++id; };
  navigator.geolocation.clearWatch = () => {};
  navigator.geolocation.getCurrentPosition = (ok, err, o) => run(ok, err, o);
};

(async () => {
  if (!existsSync(Y4M + '.done')) await makeFakeCamera(Y4M);
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 3500));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`] });
  async function newPage(mode) {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'fr-FR', serviceWorkers: 'block', permissions: ['camera'] });
    await ctx.addInitScript(() => { localStorage.setItem('avaloirs.onboarded', '1'); localStorage.setItem('avaloirs.installSnoozeUntil', String(Date.now() + 1e9)); });
    await ctx.addInitScript(MOCK);
    await ctx.addInitScript((m) => { window.__geo.mode = m; }, mode);
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Ajouter un avaloir' }).click();
    await page.locator('video').waitFor();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Prendre la photo' }).click();
    await page.getByRole('button', { name: 'Utiliser la photo' }).click();
    return { ctx, page };
  }

  // 1. Position introuvable (code 2) : plus de rotation infinie, aide + réessai
  let { ctx, page } = await newPage('unavailable');
  await page.getByText('Position introuvable').waitFor({ timeout: 8000 });
  check(true, 'Position introuvable : message explicite au lieu de « Recherche du signal… » infini');
  check(await page.getByText(/Détail technique\s:\scode 2/).isVisible(), 'Position introuvable : code technique affiché pour le support');
  const calls = await page.evaluate(() => window.__geo.calls.slice());
  check(calls.includes('high') && calls.includes('low'), 'Position introuvable : repli du GPS précis vers la position réseau tenté');
  await page.screenshot({ path: SHOTS + '34-position-introuvable.jpg', type: 'jpeg', quality: 80 });
  await page.evaluate(() => { window.__geo.mode = 'ok'; });
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Je suis au-dessus/.test(b.textContent) && !b.disabled), null, { timeout: 8000 }).then(() => check(true, 'Réessayer : la position arrive, on peut continuer')).catch(() => check(false, 'Réessayer : la position arrive, on peut continuer'));
  await ctx.close();

  // 2. Refus : consignes iPhone ; après correction du réglage, retour dans l'appli = relance automatique
  ({ ctx, page } = await newPage('denied'));
  await page.getByText('Localisation refusée').waitFor({ timeout: 8000 });
  check(await page.getByText(/Sites web de Safari/).isVisible(), 'Refus : consignes précises pour iPhone (Sites web de Safari)');
  await page.screenshot({ path: SHOTS + '35-localisation-refusee.jpg', type: 'jpeg', quality: 80 });
  await page.evaluate(() => { window.__geo.mode = 'ok'; });
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });  // retour depuis les Réglages
  await page.getByRole('button', { name: 'Je suis au-dessus' }).waitFor({ timeout: 8000 });
  check(true, 'Refus corrigé dans les Réglages : l’appli se débloque seule au retour');
  await ctx.close();

  // 3. GPS précis en échec (intérieur) mais position réseau disponible : ça passe quand même
  ({ ctx, page } = await newPage('highFails'));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Je suis au-dessus/.test(b.textContent) && !b.disabled), null, { timeout: 8000 }).catch(() => undefined);
  check(await page.getByRole('button', { name: 'Je suis au-dessus' }).isEnabled(), 'GPS précis en échec : repli automatique sur la position réseau');
  await ctx.close();

  // 4. Silence total du capteur : au bout de 12 s, aide + positionnement manuel
  ({ ctx, page } = await newPage('silent'));
  await page.getByText('Le signal tarde à venir').waitFor({ timeout: 20000 });
  check(await page.getByRole('button', { name: 'Placer sur la carte' }).isVisible(), 'Signal muet : après 12 s, aide et placement manuel proposés');
  await page.getByRole('button', { name: 'Placer sur la carte' }).click();
  await page.getByRole('button', { name: 'Valider la position' }).waitFor({ timeout: 5000 });
  check(true, 'Placement manuel : on peut poursuivre sans GPS');
  await ctx.close();

  await browser.close();
  server.kill();
  console.log(fails ? `\n${fails} échec(s)` : '\nTous les contrôles sont passés.');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
