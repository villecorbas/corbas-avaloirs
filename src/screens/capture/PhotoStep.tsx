import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { haptic, Spinner } from '../../components/ui';
import { captureFromVideo, photoVerdict, processFile, type ProcessedPhoto } from '../../lib/photo';
import { getLocationState } from '../../lib/location';

export interface PhotoResult {
  photo: ProcessedPhoto;
  url: string;
  takenAt: number;
  photoPosition?: { lat: number; lon: number; acc: number; heading?: number };
}

type CamState = 'starting' | 'live' | 'unavailable';

export function PhotoStep({ initial, onDone }: { initial?: PhotoResult; onDone: (r: PhotoResult) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<CamState>('starting');
  const [preview, setPreview] = useState<PhotoResult | null>(initial || null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null);
  const fullUrl = useMemo(() => (preview ? URL.createObjectURL(preview.photo.blob) : null), [preview]);
  useEffect(() => () => void (fullUrl && URL.revokeObjectURL(fullUrl)), [fullUrl]);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCam('unavailable');
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => undefined);
        setCam('live');
        const track = s.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean };
        if (caps.torch) setTorch(false);
      } catch {
        if (!cancelled) setCam('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((tr) => tr.stop());
      stream.current = null;
    };
  }, [preview]);

  const position = () => {
    const { fix, heading } = getLocationState();
    if (!fix || Date.now() - fix.t > 20000) return undefined;
    return { lat: fix.lat, lon: fix.lon, acc: fix.acc, heading: heading ?? undefined };
  };

  const finish = (photo: ProcessedPhoto, takenAt = Date.now()) => {
    // Une photo importée de la galerie peut dater d'ailleurs ou d'hier : on ne lui attribue
    // la position GPS actuelle que si elle vient d'être prise.
    const fresh = Math.abs(Date.now() - takenAt) < 2 * 60_000;
    setPreview({ photo, url: URL.createObjectURL(photo.thumb), takenAt, photoPosition: fresh ? position() : undefined });
  };

  const shoot = async () => {
    if (!video.current || busy) return;
    haptic();
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    setBusy(true);
    try {
      finish(await captureFromVideo(video.current));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      finish(await processFile(file), Math.min(file.lastModified || Date.now(), Date.now()));
    } finally {
      setBusy(false);
    }
  };

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const inputs = (
    <>
      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={galleryInput} type="file" accept="image/*" hidden onChange={onFile} />
    </>
  );

  if (preview) {
    const verdict = photoVerdict(preview.photo);
    return (
      <div className="camera">
        <img className="camera-preview" src={fullUrl!} alt={t('photo.previewAlt')} />
        <div className="camera-top">
          <div className={`chip ${verdict === 'ok' ? 'green' : 'orange'} pop`} style={{ backdropFilter: 'blur(10px)' }}>
            <Icon name={verdict === 'ok' ? 'check' : 'warning'} size={15} stroke={2.4} />
            {t(`photo.verdict.${verdict}`)}
          </div>
        </div>
        <div className="camera-bottom">
          {verdict !== 'ok' && <p className="footnote center" style={{ color: '#fff', margin: '0 0 12px' }}>{t(`photo.verdictHint.${verdict}`)}</p>}
          <div className="btn-row">
            <button className="btn gray" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }} onClick={() => setPreview(null)}>
              {t('photo.retake')}
            </button>
            <button className="btn" onClick={() => onDone(preview)} autoFocus>
              {t('photo.use')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="camera">
      {inputs}
      <video ref={video} className="camera-video" playsInline muted autoPlay aria-label={t('photo.viewfinder')} />
      {flash && <div className="camera-flash" />}
      <div className="camera-top">
        <div className="camera-instruction">
          <strong>{t('photo.title')}</strong>
          <span>{t('photo.hint')}</span>
        </div>
      </div>
      {cam === 'live' && (
        <div className="camera-guide" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      {cam === 'starting' && (
        <div className="camera-center">
          <Spinner size={32} />
        </div>
      )}
      {cam === 'unavailable' && (
        <div className="camera-center" style={{ padding: 32 }}>
          <div className="stack center" style={{ color: '#fff', maxWidth: 320 }}>
            <Icon name="camera" size={44} style={{ margin: '0 auto', opacity: 0.8 }} />
            <p className="subhead">{t('photo.noLiveCamera')}</p>
            <button className="btn" onClick={() => fileInput.current?.click()}>
              <Icon name="camera" /> {t('photo.openCamera')}
            </button>
          </div>
        </div>
      )}
      <div className="camera-controls">
        <button className="icon-btn dark" onClick={() => galleryInput.current?.click()} aria-label={t('photo.gallery')}>
          <Icon name="photo" />
        </button>
        <button
          className="shutter"
          onClick={cam === 'live' ? shoot : () => fileInput.current?.click()}
          disabled={busy}
          aria-label={t('photo.shoot')}
        >
          {busy ? <Spinner size={28} /> : <span />}
        </button>
        <button
          className="icon-btn dark"
          onClick={toggleTorch}
          aria-label={t('photo.torch')}
          aria-pressed={!!torch}
          style={{ visibility: torch === null ? 'hidden' : 'visible', color: torch ? 'var(--yellow)' : '#fff' }}
        >
          <Icon name={torch ? 'flash' : 'flashOff'} fill={!!torch} />
        </button>
      </div>
    </div>
  );
}
