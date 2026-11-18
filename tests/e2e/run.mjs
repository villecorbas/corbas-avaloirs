// Test de bout en bout : parcours complet sur un iPhone émulé, avec services OSM et
// Panoramax simulés. Usage : npm run build && npm run e2e
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeFakeCamera } from './fake-camera.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const shots = root + 'docs/screenshots/';
const cache = root + 'tests/e2e/.cache/';
mkdirSync(shots, { recursive: true });
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
      body: `window.AVALOIRS_CONFIG = { campaignName: 'Chasse aux avaloirs', commune: { estimatedDrains: 400 }, dailyGoal: 5,
        openstreetmap: { environment: 'production', clientId: 'e2e-client', hashtags: ['#avaloirs', '#moustiquetigre'] },
        panoramax: { instance: 'https://panoramax.openstreetmap.fr' }, overpass: ['https://overpass-api.de/api/interpreter'] };`,
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
    const elements = body.includes('area')
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
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
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
    ...devices['iPhone 14'],
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    geolocation: { ...HOME, accuracy: 4 },
    permissions: ['geolocation', 'camera'],
    serviceWorkers: 'block',
  });
  await installMocks(context);
  const page = await context.newPage();
  const errors = [];
  let lastShot = 'début';
  page.on('pageerror', (e) => errors.push(`[après ${lastShot}] ` + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' <- ')));
  page.on('console', (msg) => msg.type() === 'error' && !/tile|wmts|Failed to load resource/i.test(msg.text()) && errors.push(msg.text()));
  const shot = (name) => (lastShot = name) && page.screenshot({ path: `${shots}${name}.jpg`, type: 'jpeg', quality: 82 });
  const wait = (ms) => page.waitForTimeout(ms);

  try {
    // 1. Accueil
    await page.goto(BASE);
    await page.getByText('Ensemble contre le moustique tigre').waitFor();
    await wait(800);
    await shot('01-accueil');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await wait(700);
    await shot('02-accueil-etapes');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await wait(900);
    await shot('03-accueil-jeu');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await wait(600);
    await page.getByRole('button', { name: 'Autoriser' }).first().click();
    await page.getByRole('button', { name: 'Autoriser' }).first().click();
    await wait(600);
    await shot('04-accueil-autorisations');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByText('Votre compte de contributeur').waitFor();
    await wait(900);
    await shot('04b-accueil-compte');
    check(await page.getByRole('button', { name: 'Créer mon compte gratuit' }).isVisible(), 'Accueil : invitation à créer un compte OSM');
    check(await page.getByRole('button', { name: 'J’ai déjà un compte OpenStreetMap' }).isVisible(), 'Accueil : connexion avec un compte existant');
    await page.getByRole('button', { name: 'Plus tard' }).click();
    await page.getByText('Installer l’application').waitFor();
    await wait(600);
    await shot('05-installation');
    check(await page.getByText('Sur l’écran d’accueil').isVisible(), 'Guide d’installation iOS affiché');
    await page.getByRole('button', { name: 'Plus tard' }).click();

    // 2. Carte : avaloirs de la zone et rues à explorer
    await page.getByRole('button', { name: 'Ajouter un avaloir' }).waitFor();
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.move(210, 420, { steps: 4 });
    await page.mouse.up(); // petit déplacement : déclenche le chargement de la zone affichée
    await wait(3500); // tuiles
    await shot('06-carte');
    check(await page.getByText(/% des rues couvertes ici/).isVisible(), 'Carte : taux de couverture des rues affiché');
    check(await page.getByText('Rue à explorer').isVisible() && await page.getByText('Sans photo').isVisible(), 'Carte : légende rues à explorer / sans photo');

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
    await page.getByRole('button', { name: 'Rectangle' }).click();
    await page.getByRole('button', { name: 'Fonte / métal' }).click();
    // Question obligatoire sur l'eau stagnante : « Continuer » sans réponse est refusé.
    await page.getByRole('button', { name: 'Continuer' }).click();
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
    await page.getByText('Pas encore envoyé à la mairie').scrollIntoViewIfNeeded();
    await wait(500);
    check(await page.getByText('Pas encore envoyé à la mairie').isVisible(), 'Rappel : relevé non envoyé sans compte (écran de victoire)');
    await shot('15b-reussite-non-envoye');
    await page.getByRole('button', { name: 'Terminer' }).click();
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
    await page.getByRole('button', { name: 'Créer mon compte gratuit' }).click();
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
    await page.getByRole('button', { name: 'Terminer' }).click();

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
    await page.keyboard.press('Escape');

    // 13 bis. Couche SIG de la commune : fichier GeoJSON téléchargé et contenu vérifié
    await page.getByRole('button', { name: 'Réglages' }).click();
    const dlPromise = page.waitForEvent('download', { timeout: 20000 });
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
  console.log(failures ? `\n${failures} échec(s)` : '\nTous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
}

main();
