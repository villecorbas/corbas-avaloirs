/** Traitement des photos : capture, redimensionnement, vignette et contrôle qualité. */

const MAX_SIDE = 4032;
const THUMB_SIDE = 360;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Certains navigateurs mobiles n'appellent jamais le rappel quand la mémoire manque : on ne reste pas bloqué.
    const timer = setTimeout(() => reject(new Error('encode_timeout')), 15000);
    canvas.toBlob(
      (b) => {
        clearTimeout(timer);
        if (b) resolve(b);
        else reject(new Error('encode_failed'));
      },
      'image/jpeg',
      quality,
    );
  });
}

function drawScaled(source: CanvasImageSource, w: number, h: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export interface ProcessedPhoto {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  sharpness: number; // 0..1
  brightness: number; // 0..255
}

async function finish(canvas: HTMLCanvasElement): Promise<ProcessedPhoto> {
  const [blob, thumb] = await Promise.all([
    canvasToBlob(canvas, 0.9),
    canvasToBlob(drawScaled(canvas, canvas.width, canvas.height, THUMB_SIDE), 0.8),
  ]);
  const q = analyse(canvas);
  return { blob, thumb, width: canvas.width, height: canvas.height, ...q };
}

/** Capture l'image courante du flux vidéo de la caméra. */
export async function captureFromVideo(video: HTMLVideoElement): Promise<ProcessedPhoto> {
  // Flux pas encore prêt (largeur 0, fréquent juste après l'ouverture sur iPhone) : image vide impossible à enregistrer.
  if (!video.videoWidth || !video.videoHeight) throw new Error('video_not_ready');
  const canvas = drawScaled(video, video.videoWidth, video.videoHeight, MAX_SIDE);
  return finish(canvas);
}

/** Photo issue de l'appareil photo natif ou de la galerie (orientation EXIF appliquée). */
export async function processFile(file: Blob): Promise<ProcessedPhoto> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  if ('createImageBitmap' in window) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } else {
    const img = await loadImage(file);
    source = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  }
  const canvas = drawScaled(source, w, h, MAX_SIDE);
  // Libère la mémoire de l'image décodée (plusieurs dizaines de Mo pour une photo de 12 Mpx).
  if ('close' in source && typeof source.close === 'function') source.close();
  else if (source instanceof HTMLImageElement) URL.revokeObjectURL(source.src);
  return finish(canvas);
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Netteté : variance du laplacien sur une version réduite en niveaux de gris
 * (méthode classique de détection du flou), ramenée entre 0 et 1.
 */
export function analyse(canvas: HTMLCanvasElement): { sharpness: number; brightness: number } {
  const small = drawScaled(canvas, canvas.width, canvas.height, 400);
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, small.width, small.height);
  return analysePixels(data, width, height);
}

export function analysePixels(data: Uint8ClampedArray, width: number, height: number) {
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < width * height; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = g;
    sum += g;
  }
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += l;
      lapSq += l * l;
      n++;
    }
  }
  const mean = lapSum / Math.max(n, 1);
  const variance = lapSq / Math.max(n, 1) - mean * mean;
  return { sharpness: Math.min(1, variance / 300), brightness: sum / (width * height) };
}

export type PhotoVerdict = 'ok' | 'blurry' | 'dark';

export function photoVerdict(p: { sharpness: number; brightness: number }): PhotoVerdict {
  if (p.brightness < 40) return 'dark';
  if (p.sharpness < 0.12) return 'blurry';
  return 'ok';
}
