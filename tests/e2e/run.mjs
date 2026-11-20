// Test de bout en bout : parcours complet sur un iPhone émulé, avec services OSM et
// Panoramax simulés. Usage : npm run build && npm run e2e
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeFakeCamera } from './fake-camera.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const shots = process.env.AUDIT ? root + 'tests/e2e/.cache/audit/' : root + 'docs/screenshots/';
const cache = root + 'tests/e2e/.cache/';
mkdirSync(shots, { recursive: true });
const auditLog = [];
mkdirSync(cache, { recursive: true });

const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}/`;
const HOME = { latitude: 45.749935, longitude: 4.842265 }; // chaussée de la rue du Père Chevrier, Lyon 7e
const m = 1 / 111_320;
const lonM = m / Math.cos((HOME.latitude * Math.PI) / 180);

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

/* --------------------------- Faux services ----------------------------- */
const existing = [
  { type: 'node', id: 7001, lat: HOME.latitude + 28 * m, lon: HOME.longitude + 6 * lonM, tags: { man_made: 'manhole', manhole: 'drain', inlet: 'grate' }, user: 'Dominique', timestamp: '2026-05-02T10:00:00Z' },
  { type: 'node', id: 7002, lat: HOME.latitude - 35 * m, lon: HOME.longitude - 4 * lonM, tags: { inlet: 'kerb_opening' }, user: 'Alex69', timestamp: '2026-06-12T10:00:00Z' },
  { type: 'node', id: 7003, lat: HOME.latitude + 60 * m, lon: HOME.longitude + 40 * lonM, tags: { man_made: 'manhole', manhole: 'drain', inlet: 'kerb_grate', panoramax: 'c3f1e5aa-0000-4000-8000-000000000001' }, user: 'Dominique', timestamp: '2026-07-01T10:00:00Z' },
  { type: 'node', id: 7004, lat: HOME.latitude - 70 * m, lon: HOME.longitude + 55 * lonM, tags: { man_made: 'manhole', manhole: 'drain' }, user: 'Sam', timestamp: '2026-07-01T10:00:00Z' },
];
const state = { claimed: false, uploads: [], changesets: [], osmChanges: [], nodeVersion: 3, uploadSets: 0 };

async function installMocks(context) {
  await context.route('**/config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.AVALOIRS_CONFIG = { campaignName: 'Chasse aux avaloirs', commune: { insee: '69273', name: 'Corbas', estimatedDrains: 400 }, dailyGoal: 5,
        openstreetmap: { environment: 'production', clientId: 'e2e-client', hashtags: ['#avaloirs', '#moustiquetigre'] },
        panoramax: { instance: 'https://panoramax.openstreetmap.fr' }, overpass: ['https://overpass-api.de/api/interpreter'] };`,
    }),
  );
  // Base Adresse Nationale : liste officielle des voies de la commune.
  await context.route('https://plateforme.adresse.data.gouv.fr/lookup/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ voies: [
        { type: 'voie', nomVoie: 'Rue du Père Chevrier', nbNumeros: 20 },
        { type: 'voie', nomVoie: 'Chemin des Vignes', nbNumeros: 8 },
        { type: 'voie', nomVoie: 'Impasse des Lilas', nbNumeros: 3 },
        { type: 'lieu-dit', nomVoie: 'Lieudit Montmartin' },
      ] }),
    }),
  );
  await context.route('https://overpass-api.de/**', async (route) => {
    const body = decodeURIComponent((route.request().postData() || '').replace(/^data=/, '').replace(/\+/g, ' '));
    const extra = [
      { type: 'node', id: 7100, lat: HOME.latitude + 12 * m, lon: HOME.longitude - 30 * lonM, tags: { man_made: 'manhole', manhole: 'drain', inlet: 'grate' }, user: 'Camille_Avaloirs' },
      { type: 'node', id: 7101, lat: HOME.latitude + 90 * m, lon: HOME.longitude - 10 * lonM, tags: { man_made: 'manhole', manhole: 'drain' }, user: 'Alex69' },
    ];
    const gutter = {
      type: 'way', id: 8800, user: 'Sam', timestamp: '2026-08-01T10:00:00Z',
      tags: { waterway: 'drainage_gutter', covered: 'yes' },
      geometry: [{ lat: HOME.latitude - 20 * m, lon: HOME.longitude - 25 * lonM }, { lat: HOME.latitude - 20 * m, lon: HOME.longitude - 21 * lonM }],
    };
    // Requête de zone (carte) : avaloirs + rues réelles du quartier (géométrie OSM, prolongée).
    const street = (id, a, b) => {
      const [la1, lo1] = a, [la2, lo2] = b;
      const ext = (t) => ({ lat: la1 + (la2 - la1) * t, lon: lo1 + (lo2 - lo1) * t });
      return { type: 'way', id, tags: { highway: 'residential' }, geometry: [-6, -3, 0, 1, 4, 7].map(ext) };
    };
    const streets = [
      street(9001, [45.7502401, 4.8417403], [45.7498931, 4.8423235]), // rue du Père Chevrier
      street(9002, [45.7504439, 4.8449674], [45.7502640, 4.8447044]), // rue Saint-Jérôme
      street(9003, [45.7517501, 4.8454389], [45.7513506, 4.8449091]), // rue d'Anvers
    ];
    const recent = (e, days) => ({ ...e, timestamp: new Date(Date.now() - days * 86_400_000).toISOString() });
    const named = (id, name, a, b) => ({ ...street(id, a, b), tags: { highway: 'residential', name } });
    const elements = body.includes('["name"](area')
      ? [named(9001, 'Rue du Père Chevrier', [45.7502401, 4.8417403], [45.7498931, 4.8423235]), named(9004, 'Chemin des Vignes', [45.7600, 4.8500], [45.7610, 4.8510])]
      : body.includes('area')
      ? [recent(existing[0], 3), existing[1], recent(existing[2], 5), recent(existing[3], 9), ...extra.map((e, i) => recent(e, 1 + i)), recent(gutter, 2)]
      : body.includes('highway')
        ? [...existing, gutter, ...streets]
        : [...existing, gutter];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements }) });
  });

  // --- OpenStreetMap : OAuth 2 + API 0.6
  await context.route('https://www.openstreetmap.org/oauth2/authorize?**', (route) => {
    const u = new URL(route.request().url());
    state.authorize = Object.fromEntries(u.searchParams);
    route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=E2E-CODE&state=${u.searchParams.get('state')}` } });
  });
  await context.route('https://www.openstreetmap.org/user/new?**', (route) => {
    state.signupReferer = new URL(route.request().url()).searchParams.get('referer');
    // Simule l'inscription puis le clic sur « Continuer l'autorisation » de la page d'accueil OSM.
    route.fulfill({
      contentType: 'text/html',
      body: `<p>Bienvenue !</p><script>setTimeout(() => location.href = ${JSON.stringify('https://www.openstreetmap.org' + state.signupReferer)}, 300)</script>`,
    });
  });
  await context.route('https://www.openstreetmap.org/oauth2/token', (route) => {
    state.tokenRequest = Object.fromEntries(new URLSearchParams(route.request().postData()));
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: 'osm-e2e-token', token_type: 'Bearer', scope: 'read_prefs write_api' }) });
  });
  await context.route('https://api.openstreetmap.org/api/0.6/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/0.6', '');
    const auth = req.headers()['authorization'];
    if (auth !== 'Bearer osm-e2e-token') return route.fulfill({ status: 401, body: 'unauthorized' });
    if (path === '/user/details.json') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: 42, display_name: 'Camille_Avaloirs', changesets: { count: 12 } } }) });
    }
    if (path === '/changeset/create') {
      state.changesets.push(req.postData());
      return route.fulfill({ body: String(9000 + state.changesets.length) });
    }
    if (/\/changeset\/\d+\/upload/.test(path)) {
      const xml = req.postData();
      state.osmChanges.push(xml);
      const ids = [...xml.matchAll(/<(node|way) id="(-?\d+)"/g)].map((x) => [x[1], Number(x[2])]);
      const diff = ids.map(([type, id]) => (id < 0 ? `<${type} old_id="${id}" new_id="${12345000 - id}" new_version="1"/>` : `<${type} old_id="${id}" new_id="${id}" new_version="${state.nodeVersion + 1}"/>`));
      return route.fulfill({ contentType: 'text/xml', body: `<?xml version="1.0"?><diffResult version="0.6">${diff.join('')}</diffResult>` });
    }
    if (/\/changeset\/\d+\/close/.test(path)) return route.fulfill({ body: '' });
    const hist = path.match(/^\/(node|way)\/(\d+)\/history\.json$/);
    if (hist) {
      const mine = Number(hist[2]) >= 12345000; // objets créés par l'application : historique entièrement à notre nom (uid 42)
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [{ type: hist[1], id: Number(hist[2]), version: 1, uid: mine ? 42 : 7 }] }) });
    }
    const created = path.match(/^\/(node|way)\/(123450\d\d)\.json$/);
    if (created) {
      const isWay = created[1] === 'way';
      const el = isWay
        ? { type: 'way', id: Number(created[2]), version: 1, nodes: [12345001, 12345002], tags: { waterway: 'drainage_gutter', covered: 'yes' } }
        : { type: 'node', id: Number(created[2]), version: 1, lat: HOME.latitude, lon: HOME.longitude };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [el] }) });
    }
    const node = path.match(/^\/node\/(\d+)\.json$/);
    if (node) {
      const n = existing.find((e) => e.id === Number(node[1]));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [{ ...n, version: state.nodeVersion }] }) });
    }
    return route.fulfill({ status: 404, body: 'not mocked' });
  });

  // --- Panoramax : jeton réclamé + lots d'envoi
  await context.route('https://panoramax.openstreetmap.fr/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/auth/tokens/generate') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id: 'tok-1', jwt_token: 'pnx-e2e-token', links: [{ rel: 'claim', href: 'https://panoramax.openstreetmap.fr/api/auth/tokens/tok-1/claim' }] }),
      });
    }
    if (path === '/api/auth/tokens/tok-1/claim') {
      state.claimed = true;
      return route.fulfill({ contentType: 'text/html', body: '<h1>Jeton associé à votre compte</h1>' });
    }
    if (req.headers()['authorization'] !== 'Bearer pnx-e2e-token' || !state.claimed) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"not logged"}' });
    if (path === '/api/users/me') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'u-1', name: 'Camille_Avaloirs', tos_accepted: true, links: [] }) });
    }
    if (path === '/api/upload_sets' && req.method() === 'POST') {
      state.uploadSets++;
      state.uploadSetBody = JSON.parse(req.postData());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: `us-${state.uploadSets}` }) });
    }
    const files = path.match(/^\/api\/upload_sets\/(us-\d+)\/files$/);
    if (files) {
      const raw = req.postDataBuffer().toString('latin1');
      const field = (name) => raw.match(new RegExp(`name="${name.replace(/[.|]/g, '\\$&')}"(?:; filename="[^"]*")?\\r\\n(?:Content-Type: [^\\r]*\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`))?.[1];
      const upload = {
        pictureId: field('picture_id'),
        lat: field('override_latitude'),
        lon: field('override_longitude'),
        time: field('override_capture_time'),
        semantics: JSON.parse(field('semantics') || '[]'),
        hasJpeg: raw.includes('\xff\xd8\xff'),
      };
      state.uploads.push(upload);
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ picture_id: upload.pictureId, rejected: null, file_name: 'x.jpg', inserted_at: new Date().toISOString(), links: [] }) });
    }
    if (/\/complete$/.test(path)) return route.fulfill({ contentType: 'application/json', body: '{}' });
    if (path === '/api/search') {
      const id = new URL(req.url()).searchParams.get('ids');
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: id ? [{ id, collection: 'col-1' }] : [] }) });
    }
    const del = path.match(/^\/api\/collections\/col-1\/items\/([0-9a-f-]+)$/);
    if (del && req.method() === 'DELETE') {
      (state.pnxDeleted ||= []).push(del[1]);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
}


/** Audit d'interface (AUDIT=1) : zones tactiles < 44 pt, débordement horizontal, textes < 11 px. */
async function audit(page, name) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && b.bottom > 0 && b.top < innerHeight; };
    const small = [...document.querySelectorAll('button, a[href], input, [role=radio], [role=button], select')].filter(vis).map((e) => ({ e, b: e.getBoundingClientRect() })).filter(({ b }) => b.width < 44 || b.height < 44)
      .filter(({ e }) => !(e.closest('.leaflet-container') && !e.classList.contains('trace-handle')) && !e.closest('.dots') && !e.classList.contains('switch') && !(e.type === 'checkbox') && !e.matches('.btn.small, .sheet-close'))
      .map(({ e, b }) => `${(e.getAttribute('aria-label') || e.textContent || e.className || e.tagName).trim().slice(0, 28)} ${Math.round(b.width)}×${Math.round(b.height)}`);
    const tiny = [...document.querySelectorAll('body *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(e)).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => `${e.textContent.trim().slice(0, 24)} (${getComputedStyle(e).fontSize})`);
    const overflow = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > vw + 2 && !e.closest('.leaflet-container') && !e.closest('.onboarding-pages') && !e.closest('.sheet-backdrop')).slice(0, 3).map((e) => `${e.className || e.tagName}`);
    return { small, tiny: [...new Set(tiny)].slice(0, 5), overflow };
  });
  return { name, ...r };
}

/* ------------------------------ Scénario ------------------------------- */
async function main() {
  const y4m = cache + 'drain.y4m';
  if (!existsSync(y4m + '.done')) await makeFakeCamera(y4m);

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
    server.on('exit', reject);
    setTimeout(resolve, 6000);
  });

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
  });
  const context = await browser.newContext({
    ...devices[process.env.DEVICE || 'iPhone 14'],
    colorScheme: process.env.SCHEME || 'light',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    geolocation: { ...HOME, accuracy: 4 },
    permissions: ['geolocation', 'camera'],
    serviceWorkers: 'block',
  });
  if (process.env.TEXTSCALE) {
    // Simule une taille de texte système agrandie (Dynamic Type) : html { font-size } × facteur.
    await context.addInitScript((k) => {
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = `html { font-size: ${17 * k}px !important; }`;
        document.head.appendChild(st);
      });
    }, Number(process.env.TEXTSCALE));
  }
  await installMocks(context);
  const page = await context.newPage();
  const errors = [];
  let lastShot = 'début';
  page.on('pageerror', (e) => errors.push(`[après ${lastShot}] ` + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' <- ')));
  page.on('console', (msg) => msg.type() === 'error' && !/tile|wmts|Failed to load resource/i.test(msg.text()) && errors.push(msg.text()));
  const shot = async (name) => {
    lastShot = name;
    if (process.env.AUDIT) auditLog.push(await audit(page, name));
    return page.screenshot({ path: `${shots}${name}.jpg`, type: 'jpeg', quality: 82 });
  };
  const wait = (ms) => page.waitForTimeout(ms);

  try {
    // 1. Accueil
    await page.goto(BASE);
    await page.getByText('Le moustique tigre n’est pas qu’un agacement').waitFor();
    await wait(800);
    await shot('01-accueil');
    check(await page.getByText(/bouchon de bouteille/).isVisible(), 'Introduction : le moustique tigre se reproduit dans un peu d’eau stagnante');
    check(await page.getByText(/en particulier dans les avaloirs d’eau de pluie/).isVisible(), 'Introduction : l’eau stagnante de la rue, en particulier dans les avaloirs');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByText('Un avaloir, c’est quoi ?').waitFor();
    await wait(900);
    await shot('01b-accueil-avaloir');
    check(await page.getByText(/avale l’eau de pluie de la rue/).isVisible(), 'Introduction : définition d’un avaloir');
    check(await page.getByText(/ils ne sont pas cartographiés\s:\son ne sait pas où aller pour les traiter/).isVisible(), 'Introduction : la problématique (avaloirs non cartographiés, traitements impossibles à cibler)');
    await page.getByRole('button', { name: 'Continuer' }).click();
    check(await page.getByRole('heading', { name: 'Votre mission' }).isVisible(), 'Introduction : page « Votre mission »');
    check((await page.getByText('Repérez les avaloirs').isVisible()) && (await page.getByText('Cartographiez-les').isVisible()) && (await page.getByText('Photographiez-les').isVisible()), 'Mission : repérer, cartographier, photographier');
    check(await page.getByText(/Une trentaine de secondes par avaloir, et c’est fait/).isVisible(), 'Mission : une trentaine de secondes par avaloir');
    check(await page.getByRole('img', { name: /Coupe d’un avaloir/ }).isVisible(), 'Introduction : schéma en coupe d’un avaloir');
    await wait(700);
    await shot('02-accueil-etapes');
    await page.getByRole('button', { name: 'Continuer' }).click();
    // Engagement sur sa rue : dans l'accueil, AVANT la page des autorisations
    await page.getByText('Quelle est votre rue ?').waitFor();
    await wait(900);
    check(await page.getByText(/Votre mission\s:\sphotographier tous les avaloirs de votre rue/).isVisible(), 'Engagement : la mission est répétée clairement');
    check(await page.getByText(/Gagnez \+5\spts par rue choisie/).isVisible(), 'Engagement : une rue choisie rapporte des points');
    check(await page.getByRole('button', { name: 'Plus tard' }).isVisible(), 'Engagement : facultatif (le bouton devient « Plus tard » tant qu’aucune rue n’est choisie)');
    await page.getByRole('searchbox', { name: 'Chercher ma rue' }).fill('vigne');
    await page.getByRole('button', { name: 'Je m’engage' }).first().click();
    await page.getByText(/Engagement pris\s:\s\+5\spts/).waitFor({ timeout: 5000 });
    check(true, 'Engagement : choix d’une rue, +5 pts annoncés');
    await shot('00-premiere-rue');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await wait(600);
    await page.getByRole('button', { name: 'Autoriser' }).first().click();
    await page.getByRole('button', { name: 'Autoriser' }).first().click();
    await wait(600);
    await shot('04-accueil-autorisations');
    check(!(await page.getByText('Votre compte de contributeur').isVisible().catch(() => false)), 'Accueil : aucune demande de compte avant le premier avaloir');
    await page.getByRole('button', { name: 'C’est parti !' }).click();
    await page.getByText('Installer l’application').waitFor();
    check(!(await page.getByText('Quelle est votre rue ?').isVisible().catch(() => false)), 'Tunnel : l’engagement n’apparaît qu’à la fin de l’accueil, pas au lancement d’une appli déjà utilisée');
    await wait(600);
    await shot('05-installation');
    check(await page.getByText('Sur l’écran d’accueil').isVisible(), 'Guide d’installation iOS affiché');
    await page.getByRole('button', { name: 'Plus tard' }).click();

    // 2. Carte : avaloirs de la zone et rues à explorer
    await page.getByRole('button', { name: 'Ajouter un avaloir' }).waitFor();
    await page.mouse.move(200, 230);
    await page.mouse.down();
    await page.mouse.move(210, 250, { steps: 4 });
    await page.mouse.up(); // petit déplacement : déclenche le chargement de la zone affichée
    await wait(3500); // tuiles
    await shot('06-carte');
    check(await page.getByText('Repérez un avaloir dans la rue, puis touchez ici').isVisible(), 'Carte : bulle d’aide à la première ouverture');
    await shot('06b-carte-bulle');
    await page.getByText('Repérez un avaloir dans la rue, puis touchez ici').click(); // la bulle se ferme au toucher
    check(await page.getByText(/\d+\s% couvertes/).isVisible(), 'Carte : taux de couverture des rues affiché (légende repliée)');
    await page.getByRole('button', { name: 'Afficher la légende de la carte' }).click();
    check(await page.getByText('Rue à explorer').isVisible() && await page.getByText('Sans photo').isVisible(), 'Carte : légende dépliable (rues à explorer / sans photo)');
    await page.getByRole('button', { name: 'Masquer la légende' }).click();

    // 3. Photo
    await page.getByRole('button', { name: 'Ajouter un avaloir' }).click();
    await page.locator('video').waitFor();
    await wait(1800);
    await shot('07-photo-viseur');
    await page.getByRole('button', { name: 'Prendre la photo' }).click();
    await page.getByRole('button', { name: 'Utiliser la photo' }).waitFor();
    await wait(500);
    check(await page.getByText('Photo nette').isVisible(), 'Contrôle de netteté : photo nette');
    await shot('08-photo-apercu');
    await page.getByRole('button', { name: 'Utiliser la photo' }).click();

    // 4. Position : mesures successives légèrement différentes
    await page.getByRole('button', { name: 'Je suis au-dessus' }).waitFor();
    await wait(2500);
    await shot('09-position-approche');
    await page.getByRole('button', { name: 'Je suis au-dessus' }).click();
    for (let i = 0; i < 5; i++) {
      await wait(900);
      await context.setGeolocation({ latitude: HOME.latitude + (i % 2 ? 1 : -1) * 0.6 * m, longitude: HOME.longitude + (i - 2) * 0.3 * lonM, accuracy: 3 + (i % 3) });
      if (i === 2) await shot('10-position-mesure');
    }
    await page.getByRole('button', { name: 'Valider la position' }).waitFor({ timeout: 10000 });
    await wait(1500);
    await shot('11-position-ajustement');
    check(await page.getByText(/Position enregistrée · ±\s\d/).isVisible(), 'Position moyennée enregistrée');
    await page.getByRole('button', { name: 'Valider la position' }).click();

    // 5. Type
    await page.getByText('Quel type d’avaloir ?').waitFor();
    await wait(400);
    await shot('12-type');
    await page.getByRole('radio', { name: /Grille et bordure/ }).click();
    await page.getByRole('button', { name: 'Ajouter des détails (facultatif)' }).click();
    await page.getByRole('button', { name: 'Rectangle' }).click();
    await page.getByRole('button', { name: 'Fonte / métal' }).click();
    // Question obligatoire sur l'eau stagnante : « Continuer » sans réponse est refusé.
    await page.getByRole('button', { name: /Il reste une question sur l’eau stagnante/ }).click();
    await wait(700);
    check(await page.getByText('Répondez à cette question : c’est l’information clé pour la mairie.').isVisible(), 'Eau stagnante : réponse obligatoire');
    check(await page.getByText('Quel type d’avaloir ?').isVisible(), 'Eau stagnante : impossible de continuer sans répondre');
    await shot('13a-eau-obligatoire');
    await page.getByRole('radio', { name: /Oui, visible/ }).click();
    await page.getByRole('group', { name: 'Est-il obstrué (feuilles, déchets) ?' }).getByRole('button', { name: 'Non' }).click();
    await wait(300);
    await shot('13-type-details');
    await page.getByRole('button', { name: 'Continuer' }).click();

    // 6. Récapitulatif
    await page.getByText('Récapitulatif').waitFor();
    await page.getByText(/Rue Père Chevrier|Adresse inconnue/).first().waitFor({ timeout: 10000 });
    await wait(2000);
    await shot('14-recapitulatif');
    await page.getByRole('button', { name: 'OpenStreetMap' }).click();
    await wait(300);
    const tagsText = await page.locator('pre.tags-code').innerText();
    check(tagsText.includes('inlet=kerb_grate') && tagsText.includes('manhole=drain') && tagsText.includes('shape=rectangular'), 'Aperçu des tags OSM conforme');
    await page.getByRole('button', { name: /Enregistrer/ }).click();

    // 7. Réussite
    await page.getByText('Relever un autre avaloir').waitFor();
    await wait(1600);
    await shot('15-reussite');
    check(await page.getByText('Premier pas').isVisible(), 'Badge « Premier pas » débloqué');
    await page.getByText('Votre premier avaloir est prêt à être publié !').scrollIntoViewIfNeeded();
    await wait(500);
    check(await page.getByText('Vous quitterez l’application un instant').isVisible(), 'Premier relevé : invitation à publier, avec avertissement de redirection');
    await shot('15b-reussite-non-envoye');
    // Le compte se crée à ce moment-là : « Publier mon premier avaloir » ouvre l'assistant.
    await page.getByRole('button', { name: 'Publier mon premier avaloir' }).click();
    await page.getByText('Votre compte de contributeur').waitFor();
    await wait(900);
    check(await page.getByText('la création du compte se fait sur le site d’OpenStreetMap').isVisible(), 'Assistant : prévient que le compte se crée sur le site d’OpenStreetMap');
    check(await page.getByRole('button', { name: 'Créer mon compte et publier mes relevés' }).isVisible() && await page.getByRole('button', { name: 'J’ai déjà un compte : me connecter et publier' }).isVisible(), 'Assistant : créer un compte ou se connecter');
    check(await page.getByText('Un relevé qui reste sur votre téléphone ne sert à personne').isVisible(), 'Assistant : explique l’intérêt de se connecter (carte collaborative centralisée)');
    check(await page.getByText('Sans connexion, vos relevés restent sur ce téléphone').isVisible(), 'Assistant : prévient que sans connexion les relevés ne servent pas à la communauté');
    await shot('04b-accueil-compte');
    await page.getByRole('button', { name: 'Plus tard' }).click();
    // Pas de rappel immédiat après « Plus tard » ; il revient plus tard.
    await wait(2500);
    check(!(await page.getByText('Votre travail attend d’être envoyé').isVisible().catch(() => false)), 'Après « Plus tard » : pas de rappel immédiat');
    await page.evaluate(() => localStorage.removeItem('avaloirs.lastNudge'));
    await page.reload();
    // Fenêtre de rappel à l'ouverture, puis bandeau sur la carte.
    await page.getByText('Votre travail attend d’être envoyé').waitFor({ timeout: 8000 });
    await wait(600);
    await shot('15c-rappel-connexion');
    check(await page.getByText('points bloqués').isVisible(), 'Rappel gamifié : points bloqués affichés');
    await page.getByRole('button', { name: 'Plus tard' }).click();
    await page.getByText('1 avaloir pas encore envoyé').waitFor();
    await wait(500);
    await shot('15d-carte-bandeau');
    check(true, 'Rappel : bandeau « pas encore envoyé » sur la carte');

    // 8. Relevés en attente
    await page.getByRole('button', { name: /Relevés/ }).click();
    await page.getByText('Publiez vos relevés').waitFor();
    await wait(500);
    await shot('16-releves-attente');

    // 9. Assistant de compte : création d'un compte OSM (inscription simulée) puis Panoramax
    await page.getByRole('button', { name: 'Connecter mes comptes' }).click();
    await page.getByText('Votre compte de contributeur').waitFor();
    await page.getByRole('button', { name: 'Créer mon compte et publier mes relevés' }).click();
    await page.getByText('Votre compte en 3 étapes').waitFor();
    await wait(500);
    await shot('17a-compte-inscription');
    await page.getByRole('button', { name: 'Ouvrir la page d’inscription' }).click();
    // Retour d'openstreetmap.org : la page est rechargée, l'assistant doit reprendre à l'étape « photos ».
    await page.getByText('Dernière étape : vos photos').waitFor({ timeout: 20000 });
    check(state.signupReferer?.startsWith('/oauth2/authorize?') && state.signupReferer.includes('client_id=e2e-client') && state.signupReferer.includes('code_challenge='), 'Inscription OSM : autorisation OAuth conservée en paramètre de retour');
    check(state.authorize?.code_challenge_method === 'S256' && state.authorize?.scope === 'read_prefs write_api', 'OAuth : PKCE S256 et scopes corrects');
    check(state.tokenRequest?.code === 'E2E-CODE' && (state.tokenRequest?.code_verifier || '').length >= 43, 'OAuth : échange du code avec le vérificateur PKCE');
    check(await page.getByText('Connecté en tant que Camille_Avaloirs').isVisible(), 'Assistant repris après la redirection, compte connecté');
    await wait(500);
    check(await page.getByText('Sans cette connexion, vos photos restent sur ce téléphone').isVisible(), 'Étape photos : explique l’intérêt de Panoramax');
    await shot('17b-compte-photos');
    const popupPromise = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Autoriser la publication des photos' }).click();
    const popup = await popupPromise;
    await page.getByText('Connexion en cours…').waitFor({ timeout: 2500 }).catch(() => undefined);
    check(await page.getByText('Quand la page affiche « Connexion terminée »').isVisible().catch(() => false), 'Panoramax : consignes de retour dans l’appli affichées');
    await shot('17d-panoramax-attente');
    await popup.waitForLoadState().catch(() => undefined);
    await popup.close().catch(() => undefined);
    await page.getByText('Tout est prêt !').waitFor({ timeout: 15000 });
    check(state.claimed, 'Panoramax : jeton réclamé via la page de connexion');
    await wait(900);
    await shot('17c-compte-pret');
    await page.getByRole('button', { name: 'Terminé' }).click();

    // 10. Synchronisation automatique
    await page.waitForFunction(() => true);
    for (let i = 0; i < 30 && state.osmChanges.length === 0; i++) await wait(500);
    await wait(800);
    check(state.uploads.length === 1, 'Panoramax : 1 photo envoyée');
    const up = state.uploads[0] || {};
    check(up.hasJpeg && Math.abs(Number(up.lat) - HOME.latitude) < 0.0005 && up.time, 'Panoramax : JPEG + position + date de prise de vue');
    check((up.semantics || []).some((s) => s.key === 'osm|inlet' && s.value === 'kerb_grate'), 'Panoramax : tags sémantiques osm|*');
    check((up.semantics || []).some((s) => s.key === 'avaloirs|standing_water' && s.value === 'yes'), 'Panoramax : observation « eau stagnante »');
    check(state.uploadSetBody?.no_deduplication === true, 'Panoramax : lot d’envoi sans déduplication');
    const change1 = state.osmChanges[0] || '';
    check(change1.includes('<create>') && change1.includes('k="inlet" v="kerb_grate"') && change1.includes(`k="panoramax" v="${up.pictureId}"`), 'OSM : nœud créé avec inlet=kerb_grate et lien panoramax');
    check(!/k="(addr|eau|standing)/.test(change1), 'OSM : aucune donnée hors schéma (adresse, observations)');
    const cs1 = state.changesets[0] || '';
    check(cs1.includes('k="hashtags" v="#avaloirs;#moustiquetigre"') && cs1.includes('k="created_by"') && cs1.includes('k="source" v="survey;Panoramax"'), 'OSM : tags du changeset (hashtags, source, created_by)');

    await page.getByRole('button', { name: /Relevés/ }).click();
    await page.getByText('Publié').first().waitFor({ timeout: 10000 });
    await wait(500);
    await shot('18-releves-publies');

    // 11. Deuxième relevé : avaloir déjà présent dans OSM → compléter avec la photo
    await page.getByRole('button', { name: 'Carte' }).click();
    await context.setGeolocation({ latitude: existing[0].lat + 0.8 * m, longitude: existing[0].lon, accuracy: 3 });
    await page.getByRole('button', { name: 'Ajouter un avaloir' }).click();
    await page.getByRole('button', { name: 'Prendre la photo' }).click();
    await page.getByRole('button', { name: 'Utiliser la photo' }).click();
    await page.getByRole('button', { name: 'Je suis au-dessus' }).click();
    await page.getByRole('button', { name: 'Valider la position' }).waitFor({ timeout: 12000 });
    check(await page.getByText(/déjà cartographié à/).isVisible(), 'Doublon : alerte en direct avant même la validation');
    await page.getByRole('button', { name: 'Valider la position' }).click();
    await page.getByText('Avaloir déjà cartographié').waitFor();
    await wait(500);
    await shot('19-doublon');
    await page.getByRole('button', { name: 'C’est le même : ajouter ma photo' }).click();
    await page.getByText('Quel type d’avaloir ?').waitFor();
    check(await page.getByRole('radio', { name: /Grille au sol/ }).getAttribute('aria-checked') === 'true', 'Type pré-rempli depuis OSM (inlet=grate)');
    await page.getByRole('radio', { name: /Possible/ }).click();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: /Enregistrer/ }).click();
    await page.getByText('Relever un autre avaloir').waitFor();
    for (let i = 0; i < 30 && state.osmChanges.length < 2; i++) await wait(500);
    const change2 = state.osmChanges[1] || '';
    check(change2.includes('<modify>') && change2.includes('<node id="7001"') && change2.includes(`version="${state.nodeVersion}"`), 'OSM : modification du nœud existant avec sa version');
    check(change2.includes('k="inlet" v="grate"') && change2.includes(`k="panoramax" v="${state.uploads[1]?.pictureId}"`) && change2.includes('k="check_date"'), 'OSM : photo ajoutée sans écraser les tags existants');
    // Rappel après le 2e avaloir : inviter ses voisins rapporte des points
    await page.getByText('Déjà 2 avaloirs : bravo !').scrollIntoViewIfNeeded();
    await wait(600);
    await shot('30-rappel-invitation');
    check(await page.getByText('par invitation envoyée').isVisible(), 'Après le 2e avaloir : rappel « inviter mes voisins » avec +5 pts');
    await page.getByRole('button', { name: 'Inviter mes voisins' }).click();
    await page.getByText('Gagnez +5 pts par invitation envoyée').waitFor();
    await wait(500);
    await shot('31-invitation-points');
    const popupP = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await page.getByRole('link', { name: /WhatsApp/ }).click();
    (await popupP)?.close().catch(() => undefined);
    await page.getByText('+5 pts : invitation envoyée').waitFor({ timeout: 5000 });
    check(true, 'Invitation envoyée : +5 pts annoncés');
    await wait(700);
    check(await page.getByText(/1 invitation récompensée · \+5\spts/).isVisible(), 'Invitation : compteur de points mis à jour');
    check((await page.locator('.reward-dots span.on').count()) === 1, 'Invitation : 1 sur 3 du jour');
    await page.getByRole('button', { name: 'Fermer' }).first().click();

    // 11 bis. Caniveau à grille : tracé sur la photo aérienne → ligne waterway=drainage_gutter
    await context.setGeolocation({ latitude: HOME.latitude + 10 * m, longitude: HOME.longitude + 25 * lonM, accuracy: 3 });
    await page.getByRole('button', { name: 'Ajouter un avaloir' }).click();
    await page.getByRole('button', { name: 'Prendre la photo' }).click();
    await page.getByRole('button', { name: 'Utiliser la photo' }).click();
    await page.getByRole('button', { name: 'Je suis au-dessus' }).click();
    await page.getByRole('button', { name: 'Valider la position' }).waitFor({ timeout: 12000 });
    await page.getByRole('button', { name: 'Valider la position' }).click();
    await page.getByText('Quel type d’avaloir ?').waitFor();
    await page.getByRole('radio', { name: /Caniveau à grille/ }).click();
    await page.getByRole('button', { name: 'Ajouter des détails (facultatif)' }).click();
    await page.getByRole('button', { name: 'Fonte / métal' }).click();
    await page.getByRole('radio', { name: /Non.*Sec/ }).click();
    check(await page.getByText(/waterway=drainage_gutter \+ covered=yes/).isVisible(), 'Caniveau : explication du schéma OSM affichée');
    check(!(await page.getByText('Forme de la grille').isVisible()), 'Caniveau : pas de question sur la forme');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByText('Tracez le caniveau').waitFor();
    await wait(2500);
    const handles = page.locator('.trace-handle');
    check((await handles.count()) === 2, 'Tracé : deux poignées déplaçables');
    const lengthBefore = await page.getByRole('status').filter({ hasText: /≈/ }).innerText();
    const box = await handles.nth(1).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 8 });
    await page.mouse.up();
    await wait(400);
    const lengthAfter = await page.getByRole('status').filter({ hasText: /≈/ }).innerText();
    check(lengthBefore !== lengthAfter, `Tracé : la longueur suit la poignée (${lengthBefore} → ${lengthAfter})`);
    await page.getByRole('button', { name: 'Inverser le sens' }).click();
    await wait(400);
    await shot('24-caniveau-trace');
    await page.getByRole('button', { name: 'Valider le tracé' }).click();
    await page.getByText('Nouveau caniveau tracé sur la carte libre').waitFor();
    await page.getByRole('button', { name: /OpenStreetMap/ }).click();
    await wait(1500);
    await shot('25-caniveau-recapitulatif');
    await page.getByRole('button', { name: /Enregistrer/ }).click();
    await page.getByText('Relever un autre avaloir').waitFor();
    for (let i = 0; i < 30 && state.osmChanges.length < 3; i++) await wait(500);
    const change3 = state.osmChanges[2] || '';
    const wayMatch = change3.match(/<way id="-1" changeset="\d+">([\s\S]*?)<\/way>/);
    check(!!wayMatch, 'OSM : caniveau créé comme un chemin (way)');
    const wayBody = wayMatch ? wayMatch[1] : '';
    const ndRefs = [...wayBody.matchAll(/<nd ref="(-\d+)"\/>/g)].map((x) => x[1]);
    check(ndRefs.length === 2 && ndRefs.every((r) => change3.includes(`<node id="${r}" `) && change3.includes(`<node id="${r}" lat=`)), 'OSM : 2 nœuds créés et référencés par le chemin');
    check(ndRefs.every((r) => new RegExp(`<node id="${r}"[^>]*/>`).test(change3)), 'OSM : nœuds du tracé sans tags');
    check(wayBody.includes('k="waterway" v="drainage_gutter"') && wayBody.includes('k="covered" v="yes"') && wayBody.includes('k="material" v="metal"'), 'OSM : waterway=drainage_gutter + covered=yes + material');
    check(wayBody.includes(`k="panoramax" v="${state.uploads[2]?.pictureId}"`) && !/manhole|inlet|shape/.test(wayBody), 'OSM : lien photo, sans tags de regard');
    check((state.uploads[2]?.semantics || []).some((s) => s.key === 'osm|waterway' && s.value === 'drainage_gutter'), 'Panoramax : photo annotée osm|waterway=drainage_gutter');
    await page.getByRole('button', { name: 'Terminer' }).click();
    await page.getByRole('button', { name: /Relevés/ }).click();
    await page.locator('.record-row').first().click();
    await page.getByText('Longueur').waitFor();
    await wait(1500);
    await shot('26-caniveau-fiche');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Carte' }).click();

    // 12. Défis
    await page.getByRole('button', { name: 'Défis' }).click();
    await page.getByText(/sur \d+ ce mois-ci|participants? ce mois-ci/).waitFor({ timeout: 15000 });
    await wait(800);
    await shot('20-defis');
    await page.getByRole('button', { name: /Classement des participants/ }).click();
    await page.getByLabel('Podium').waitFor();
    await wait(900);
    await shot('21-classement');
    check(await page.getByText('Votre classement').isVisible(), 'Classement : rang du participant affiché');
    await page.getByRole('button', { name: 'Depuis le début' }).click();
    await wait(400);
    check((await page.locator('.podium-step').count()) === 3, 'Classement : podium des 3 premiers');
    await page.getByRole('button', { name: 'Fermer' }).first().click();

    // 12 bis. Partager son score, inviter ses proches
    await page.getByRole('button', { name: /Partager mon score/ }).click();
    await page.locator('.score-card-preview img').waitFor({ timeout: 10000 });
    await wait(700);
    await shot('27-partage-score');
    const fb = await page.getByRole('link', { name: /Facebook/ }).getAttribute('href');
    check(fb.startsWith('https://www.facebook.com/sharer/sharer.php?u=') && decodeURIComponent(fb).includes('ref=Camille_Avaloirs'), 'Partage : lien Facebook avec lien d’invitation');
    await page.getByRole('button', { name: 'Fermer' }).first().click();
    await page.getByRole('button', { name: /Inviter mes proches/ }).click();
    await page.getByText('Message envoyé').waitFor();
    await wait(500);
    await shot('28-invitation');
    const wa = await page.getByRole('link', { name: /WhatsApp/ }).getAttribute('href');
    const sms = await page.getByRole('link', { name: /SMS/ }).getAttribute('href');
    const mail = await page.getByRole('link', { name: /E-mail/ }).getAttribute('href');
    check(wa.startsWith('https://wa.me/?text=') && sms.startsWith('sms:') && mail.startsWith('mailto:?subject='), 'Invitation : WhatsApp, SMS et e-mail');
    check(decodeURIComponent(wa).includes('?ref=Camille_Avaloirs'), 'Invitation : lien signé du pseudonyme');
    await page.getByRole('button', { name: 'Fermer' }).first().click();

    // 13. Fiche d'un relevé
    await page.getByRole('button', { name: /Relevés/ }).click();
    await page.locator('.record-row').first().click();
    await wait(1500);
    await shot('22-fiche-releve');
    // Suppression d'un relevé PUBLIÉ (le caniveau : chemin créé par nous) → retiré d'OSM et de Panoramax
    const rowsBefore = await page.locator('.record-row').count();
    await page.getByRole('button', { name: 'Supprimer' }).click();
    await page.getByText('Ce relevé sera retiré de ce téléphone, mais aussi d’OpenStreetMap et de Panoramax.').waitFor();
    await wait(400);
    await shot('36-suppression-publie');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Supprimer' }).click();
    await page.getByText('retiré d’OpenStreetMap et de Panoramax').waitFor({ timeout: 10000 });
    const del1 = state.osmChanges.filter((x) => x.includes('<delete'));
    check(del1.length === 1 && /<delete>\s*<way id="12345001"/.test(del1[0]) && /<delete if-unused="true">\s*<node id="12345001"/.test(del1[0]), 'Suppression : le chemin créé par nous et ses nœuds sont supprimés d’OSM');
    check(state.pnxDeleted?.length === 1 && state.pnxDeleted[0] === state.uploads[2]?.pictureId, 'Suppression : la photo est supprimée de Panoramax');
    await wait(500);
    check((await page.locator('.record-row').count()) === rowsBefore - 1, 'Suppression : le relevé disparaît de la liste');
    // Relevé qui complétait un avaloir EXISTANT : on retire sa photo, jamais l'objet d'un autre
    await page.locator('.record-row').first().click();
    await wait(800);
    await page.getByRole('button', { name: 'Supprimer' }).click();
    await page.getByText('Cet avaloir existait déjà sur OpenStreetMap : seule votre photo est retirée').waitFor();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Supprimer' }).click();
    for (let i = 0; i < 30 && (state.pnxDeleted?.length || 0) < 2; i++) await wait(300);
    check(state.osmChanges.filter((x) => x.includes('<delete')).length === 1, 'Suppression : l’avaloir existant d’un autre contributeur n’est jamais supprimé');
    check(state.pnxDeleted?.length === 2, 'Suppression : sa photo est retirée de Panoramax');

    // 13 ter. Campagne « Mes rues à relever » : liste des rues, recherche, inscription pré-remplie
    await page.getByRole('button', { name: 'Défis' }).click();
    await page.getByRole('button', { name: /Mes rues à relever/ }).click();
    await page.getByText('Rue du Père Chevrier').waitFor({ timeout: 10000 });
    await wait(500);
    check(await page.getByRole('list').getByText('Chemin des Vignes').isVisible(), 'Campagne : toutes les rues de la liste officielle (BAN) sont affichées');
    check(!(await page.getByText('Lieudit Montmartin').isVisible().catch(() => false)), 'Campagne : les lieux-dits sont écartés');
    check(await page.getByText('Avancement inconnu').isVisible(), 'Campagne : une rue sans tracé OSM reste listée, avancement inconnu');
    // Plusieurs rues : engagement local, sans inscription ni envoi de données
    check(await page.getByText('Ma rue à relever').isVisible(), 'Campagne : la rue choisie au premier lancement est conservée');
    await page.getByRole('button', { name: 'Je m’engage' }).nth(0).click();
    await page.getByText('Mes 2 rues à relever').waitFor();
    check(await page.getByText('Inviter mes voisins à m’aider').isVisible(), 'Campagne : plusieurs rues choisies, partage de l’engagement proposé');
    check(await page.getByText(/aucune inscription, aucune donnée envoyée/).isVisible(), 'Campagne : l’engagement reste sur le téléphone');
    await shot('40-campagne-rues');
    await page.getByRole('searchbox', { name: 'Chercher ma rue' }).fill('vignes');
    check(!(await page.getByText('Rue du Père Chevrier').isVisible().catch(() => false)), 'Campagne : la recherche filtre sans tenir compte des accents ni de la casse');
    await page.getByRole('searchbox', { name: 'Chercher ma rue' }).fill('');
    await page.getByRole('button', { name: 'Mes rues', exact: true }).click();
    check(!(await page.getByText('Rue du Père Chevrier').isVisible().catch(() => false)), 'Campagne : le filtre « Mes rues » ne garde que les rues choisies');
    await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
    await wait(400);
    // L’engagement est conservé et résumé sur la carte de l’onglet Défis
    check(await page.getByText(/2 rues choisies/).isVisible(), 'Campagne : « Mes rues » résumées sur l’onglet Défis');

    // 13 bis. Couche SIG de la commune : fichier GeoJSON téléchargé et contenu vérifié
    await page.getByRole('button', { name: 'Réglages' }).click();
    const dlPromise = page.waitForEvent('download', { timeout: 20000 });
    await page.getByRole('button', { name: /Options avancées/ }).click();
    await page.getByRole('button', { name: /Couche SIG de la commune/ }).click();
    const dl = await dlPromise;
    const geo = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    check(/^avaloirs_osm_\d+_.*\.geojson$/.test(dl.suggestedFilename()), `Couche SIG : fichier ${dl.suggestedFilename()} téléchargé`);
    check(geo.type === 'FeatureCollection' && geo.features.length >= 5, `Couche SIG : ${geo.features.length} objets exportés`);
    check(geo.features.some((f) => f.geometry.type === 'LineString' && f.properties.waterway === 'drainage_gutter' && f.properties.longueur_m > 0), 'Couche SIG : caniveau exporté comme ligne avec sa longueur');
    check(geo.features.some((f) => f.properties.photo_url), 'Couche SIG : lien vers la photo');
    await page.getByText(/éléments? exportés?/).waitFor({ timeout: 5000 });
    check(true, 'Couche SIG : message de confirmation affiché');

    // 14. Anglais + mode sombre
    await page.getByRole('button', { name: 'Réglages' }).click();
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByText('Publishing accounts').waitFor();
    check(true, 'Bascule en anglais');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByRole('button', { name: 'Add a drain' }).isVisible().catch(() => false);
    await page.getByRole('button', { name: 'Map' }).click();
    await page.getByRole('button', { name: 'Add a drain' }).click();
    await page.getByRole('button', { name: 'Take photo' }).click();
    await page.getByRole('button', { name: 'Use photo' }).click();
    await page.getByRole('button', { name: 'I’m over it' }).click();
    await page.getByRole('button', { name: 'Confirm position' }).waitFor({ timeout: 12000 });
    await context.setGeolocation({ ...HOME, accuracy: 3 });
    await page.getByRole('button', { name: 'Confirm position' }).click();
    const other = page.getByRole('button', { name: /another drain/ });
    if (await other.isVisible().catch(() => false)) await other.click();
    await page.getByText('What type of drain?').waitFor();
    await wait(500);
    await shot('23-type-anglais-sombre');

    check(errors.length === 0, `Aucune erreur JavaScript${errors.length ? ' : ' + errors.slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    failures++;
    console.error('✗ Scénario interrompu :', e.message);
    await shot('zz-erreur').catch(() => undefined);
  } finally {
    await browser.close();
    server.kill();
  }
  if (process.env.AUDIT) {
    for (const a of auditLog) if (a.small.length || a.tiny.length || a.overflow.length) console.log(`AUDIT ${a.name}: ${a.small.length ? 'petites zones → ' + a.small.join(' | ') : ''}${a.tiny.length ? ' ; texte <11px → ' + a.tiny.join(' | ') : ''}${a.overflow.length ? ' ; débordement → ' + a.overflow.join(' | ') : ''}`);
  }
  console.log(failures ? `\n${failures} échec(s)` : '\nTous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
}

main();
