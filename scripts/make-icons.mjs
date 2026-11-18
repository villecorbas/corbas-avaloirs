// Génère les icônes PNG de l'application à partir de public/icons/favicon.svg (via Playwright).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = readFileSync(root + 'favicon.svg', 'utf8');
// Variante plein cadre (iOS arrondit lui-même) et variante « maskable » (zone de sécurité Android).
const fullBleed = svg.replace('rx="112"', 'rx="0"');
const maskable = fullBleed.replace('<path', '<g transform="translate(51 51) scale(.8)"><path').replace('</svg>', '</g></svg>').replace(/<rect width="512" height="512" rx="0" fill="url\(#bg\)"\/>\n  <g transform/, (m) => m);

const jobs = [
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'apple-touch-icon.png', size: 180, src: fullBleed },
  { file: 'icon-maskable-512.png', size: 512, src: maskable },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${j.src.replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)}</body></html>`);
  await page.screenshot({ path: root + j.file, omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  console.log('✓', j.file);
}
await browser.close();
