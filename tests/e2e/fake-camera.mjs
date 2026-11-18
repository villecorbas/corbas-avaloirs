// Fabrique une fausse vidéo de caméra (Y4M) montrant une grille d'avaloir vue de dessus,
// utilisée par Chromium (--use-file-for-fake-video-capture) pendant les tests.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

export async function makeFakeCamera(outFile, width = 1280, height = 720) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<canvas id="c" width="${width}" height="${height}"></canvas><style>body{margin:0}</style>`);
  await page.evaluate(([W, H]) => {
    const c = document.getElementById('c');
    const g = c.getContext('2d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Chaussée : asphalte granuleux
    g.fillStyle = '#5d6064';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90000; i++) {
      const v = 60 + rnd() * 70;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.35 + rnd() * 0.4})`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    // Bordure de trottoir et caniveau béton
    g.fillStyle = '#b8b3a7';
    g.fillRect(0, 0, W, 150);
    g.fillStyle = '#9d988d';
    g.fillRect(0, 150, W, 26);
    g.fillStyle = '#a9a69f';
    g.fillRect(0, 176, W, 120);
    for (let i = 0; i < 25000; i++) {
      const v = 140 + rnd() * 60;
      g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`;
      g.fillRect(rnd() * W, rnd() * 296, 1.5, 1.5);
    }
    // Grille en fonte
    const gx = W / 2 - 230, gy = 190, gw = 460, gh = 300;
    g.fillStyle = '#2d2f32';
    g.beginPath(); g.roundRect(gx - 14, gy - 14, gw + 28, gh + 28, 10); g.fill();
    g.fillStyle = '#3f4246';
    g.beginPath(); g.roundRect(gx, gy, gw, gh, 6); g.fill();
    for (let i = 0; i < 11; i++) {
      const x = gx + 22 + i * 39;
      g.fillStyle = '#0c0d0e';
      g.beginPath(); g.roundRect(x, gy + 22, 20, gh - 44, 8); g.fill();
      g.fillStyle = 'rgba(120,190,230,0.25)';
      g.fillRect(x + 3, gy + gh - 90, 14, 50);
    }
    // Reflets métalliques et rouille
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 3;
    g.strokeRect(gx + 4, gy + 4, gw - 8, gh - 8);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${120 + rnd() * 60},${60 + rnd() * 30},20,0.25)`;
      g.fillRect(gx + rnd() * gw, gy + rnd() * gh, 2, 2);
    }
    // Quelques feuilles mortes
    for (let i = 0; i < 9; i++) {
      g.save();
      g.translate(gx - 60 + rnd() * (gw + 120), gy + rnd() * gh);
      g.rotate(rnd() * 6);
      g.fillStyle = ['#a8662b', '#c58b3a', '#7b5a2a'][i % 3];
      g.beginPath(); g.ellipse(0, 0, 22, 11, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }, [width, height]);
  const dir = mkdtempSync(join(tmpdir(), 'cam-'));
  const png = join(dir, 'frame.png');
  await page.locator('#c').screenshot({ path: png });
  await browser.close();
  // Conversion en Y4M (format lu nativement par Chromium).
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', '1', '-r', '10', '-pix_fmt', 'yuv420p', outFile]);
  writeFileSync(outFile + '.done', '');
  return outFile;
}
