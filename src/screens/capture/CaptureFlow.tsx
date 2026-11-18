import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { haptic, Sheet } from '../../components/ui';
import { saveRecord, uuid, kvGet, kvSet, requestPersistence, type DrainRecord } from '../../lib/db';
import { computeProgress, newlyUnlocked, qualityScore, recordPoints, type BadgeState, type PointLine, type Progress } from '../../lib/gamification';
import { reverseGeocode, type Address } from '../../lib/geocode';
import { distance } from '../../lib/geo';
import { DRAIN_TYPES, needsTrace } from '../../lib/taxonomy';
import { useLocation } from '../../lib/location';
import { cachedNearbyDrains, fetchNearbyDrains, type OsmDrain } from '../../lib/overpass';
import { useRecords } from '../../lib/store';
import { syncNow } from '../../lib/sync';
import { isOsmMappable, typeFromTags, type DrainDetails, type DrainMaterial, type DrainShape, type Observations } from '../../lib/taxonomy';
import { PhotoStep, type PhotoResult } from './PhotoStep';
import { LocateStep, type LocateResult } from './LocateStep';
import { TypeStep } from './TypeStep';
import { ReviewStep } from './ReviewStep';
import { TraceStep, type TraceLine } from './TraceStep';
import { SuccessStep } from './SuccessStep';

type Step = 'photo' | 'locate' | 'type' | 'trace' | 'review' | 'success';

const SHAPES: DrainShape[] = ['rectangular', 'square', 'circular'];
const MATERIALS: DrainMaterial[] = ['metal', 'concrete'];

export function CaptureFlow({ onClose, onOpenAccounts }: { onClose: () => void; onOpenAccounts: () => void }) {
  const records = useRecords() || [];
  const location = useLocation(true); // démarre le GPS dès l'ouverture
  const [step, setStep] = useState<Step>('photo');
  const [photo, setPhoto] = useState<PhotoResult>();
  const [loc, setLoc] = useState<LocateResult>();
  const [details, setDetails] = useState<Partial<DrainDetails>>({});
  const [line, setLine] = useState<TraceLine>();
  const [obs, setObs] = useState<Observations>({});
  const [address, setAddress] = useState<Address>();
  const [addrLoading, setAddrLoading] = useState(false);
  const [nearby, setNearby] = useState<OsmDrain[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [result, setResult] = useState<{ points: { total: number; lines: PointLine[] }; before: Progress; after: Progress; unlocked: BadgeState[] }>();
  const fetchedAt = useRef<{ lat: number; lon: number } | null>(null);

  // Avaloirs déjà cartographiés autour (pour l'affichage et la détection de doublons).
  useEffect(() => {
    void cachedNearbyDrains().then((c) => c && setNearby((n) => (n.length ? n : c.drains)));
  }, []);
  useEffect(() => {
    const fix = location.fix;
    if (!fix || fix.acc > 100) return;
    if (fetchedAt.current && distance(fetchedAt.current, fix) < 150) return;
    fetchedAt.current = { lat: fix.lat, lon: fix.lon };
    fetchNearbyDrains(fix, 450)
      .then(setNearby)
      .catch(() => undefined);
  }, [location.fix]);

  // Étapes : le tracé n'apparaît que pour un nouveau caniveau à grille.
  const withTrace = details.type ? needsTrace(details.type) && loc?.enrich?.type !== 'way' : false;
  const ORDER: Step[] = withTrace ? ['photo', 'locate', 'type', 'trace', 'review'] : ['photo', 'locate', 'type', 'review'];
  const orderRef = useRef(ORDER);
  orderRef.current = ORDER;

  // Bouton « retour » d'Android : recule d'une étape.
  const stepRef = useRef(step);
  stepRef.current = step;
  const closing = useRef(false);
  useEffect(() => {
    history.pushState({ capture: true }, '');
    const onPop = () => {
      if (closing.current) return;
      const s = stepRef.current;
      const order = orderRef.current;
      const i = order.indexOf(s);
      if (i > 0) {
        setStep(order[i - 1]);
        history.pushState({ capture: true }, '');
      } else {
        closing.current = true;
        onClose();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onClose]);

  const close = useCallback(() => {
    closing.current = true;
    if (history.state?.capture) history.back();
    onClose();
  }, [onClose]);

  const requestClose = () => {
    if (step === 'success' || (!photo && step === 'photo')) close();
    else setConfirmClose(true);
  };

  const back = () => {
    const i = ORDER.indexOf(step);
    if (i > 0) setStep(ORDER[i - 1]);
  };

  const onLocated = (r: LocateResult) => {
    setLoc(r);
    setLine(undefined);
    if (r.enrich) {
      const tags = r.enrich.tags;
      setDetails({
        type: typeFromTags(tags),
        shape: SHAPES.includes(tags.shape as DrainShape) ? (tags.shape as DrainShape) : undefined,
        material: MATERIALS.includes(tags.material as DrainMaterial) ? (tags.material as DrainMaterial) : undefined,
      });
    }
    setAddress(undefined);
    setAddrLoading(true);
    reverseGeocode(r.position)
      .then(setAddress)
      .catch(() => undefined)
      .finally(() => setAddrLoading(false));
    setStep('type');
  };

  const points = useMemo(() => {
    if (!loc || !details.type || !photo) return { total: 0, lines: [] };
    return recordPoints(
      {
        acc: loc.position.acc,
        samples: loc.position.samples,
        sharpness: photo.photo.sharpness,
        details: details as DrainDetails,
        observations: obs,
        mode: loc.enrich ? 'enrich' : 'new',
        at: Date.now(),
      },
      records,
    );
  }, [loc, details, obs, photo, records]);

  const save = async () => {
    if (!photo || !loc || !details.type) return;
    setSaving(true);
    const now = Date.now();
    const traced = details.type === 'channel' && withTrace && line ? line : undefined;
    const d: DrainDetails = { ...(details as DrainDetails), length: traced ? Math.round(distance(traced.a, traced.b) * 10) / 10 : undefined };
    const rec: DrainRecord = {
      id: uuid(),
      createdAt: now,
      updatedAt: now,
      position: loc.position,
      photoPosition: photo.photoPosition,
      line: traced,
      photoTakenAt: photo.takenAt,
      photoSharpness: photo.photo.sharpness,
      details: d,
      observations: obs,
      address,
      mode: loc.enrich ? 'enrich' : 'new',
      osmTarget: loc.enrich ? { type: loc.enrich.type ?? 'node', id: loc.enrich.id, tags: loc.enrich.tags } : undefined,
      quality: qualityScore({ acc: loc.position.acc, samples: loc.position.samples, sharpness: photo.photo.sharpness, details: d, observations: obs }),
      points: points.total,
      sync: {
        panoramax: { status: 'pending', pictureId: uuid(), attempts: 0 },
        osm: { status: isOsmMappable(d.type) ? 'pending' : 'skipped', attempts: 0 },
      },
    };
    const before = computeProgress(records);
    await saveRecord(rec, { blob: photo.photo.blob, thumb: photo.photo.thumb });
    const after = computeProgress([rec, ...records]);
    void requestPersistence();
    // Commune détectée automatiquement au premier relevé.
    if (address?.citycode && !(await kvGet('commune'))) await kvSet('commune', { insee: address.citycode, name: address.city });
    haptic('success');
    setResult({ points, before, after, unlocked: newlyUnlocked(before, after) });
    setSaving(false);
    setStep('success');
    void syncNow();
  };

  const another = () => {
    setPhoto(undefined);
    setLoc(undefined);
    setLine(undefined);
    setDetails({});
    setObs({});
    setAddress(undefined);
    setResult(undefined);
    setStep('photo');
  };

  const stepIndex = ORDER.indexOf(step);
  const dark = step === 'photo';

  return (
    <div className={`capture ${dark ? 'dark' : ''}`} role="dialog" aria-modal="true" aria-label={t('capture.title')}>
      {step !== 'success' && (
        <header className={`capture-bar ${step === 'type' || step === 'review' ? 'solid' : ''}`}>
          {stepIndex > 0 ? (
            <button className={`icon-btn ${dark ? 'dark' : ''}`} onClick={back} aria-label={t('common.back')}>
              <Icon name="chevronLeft" stroke={2.4} />
            </button>
          ) : (
            <span style={{ width: 44 }} />
          )}
          <div className="steps" aria-label={t('capture.stepOf', { n: stepIndex + 1, total: ORDER.length })}>
            {ORDER.map((s, i) => (
              <span key={s} className={i <= stepIndex ? 'on' : ''} />
            ))}
          </div>
          <button className={`icon-btn ${dark ? 'dark' : ''}`} onClick={requestClose} aria-label={t('common.close')}>
            <Icon name="close" stroke={2.4} />
          </button>
        </header>
      )}

      <div className="capture-body">
        {step === 'photo' && (
          <PhotoStep
            initial={photo}
            onDone={(r) => {
              setPhoto(r);
              setStep(loc ? 'type' : 'locate');
            }}
          />
        )}
        {step === 'locate' && <LocateStep nearby={nearby} myRecords={records} onDone={onLocated} />}
        {step === 'type' && (
          <TypeStep
            photoUrl={photo?.url}
            details={details}
            observations={obs}
            enrichNote={!!loc?.enrich}
            allowedTypes={
              // Un regard existant ne devient pas un caniveau, ni l'inverse.
              loc?.enrich ? (loc.enrich.type === 'way' ? ['channel'] : DRAIN_TYPES.filter((x) => x !== 'channel')) : DRAIN_TYPES
            }
            onChange={(d, o) => {
              setDetails(d);
              setObs(o);
            }}
            onNext={() => setStep(withTrace ? 'trace' : 'review')}
          />
        )}
        {step === 'trace' && loc && (
          <TraceStep
            center={loc.position}
            initial={line}
            onDone={(l) => {
              setLine(l);
              setStep('review');
            }}
          />
        )}
        {step === 'review' && photo && loc && details.type && (
          <ReviewStep
            photoUrl={photo.url}
            position={loc.position}
            details={details as DrainDetails}
            observations={obs}
            sharpness={photo.photo.sharpness}
            address={address}
            addressLoading={addrLoading}
            enrichTags={loc.enrich?.tags}
            line={details.type === 'channel' && withTrace ? line : undefined}
            points={points}
            saving={saving}
            onSave={save}
          />
        )}
        {step === 'success' && result && (
          <SuccessStep
            {...result}
            onAnother={another}
            onFinish={close}
            onConnect={() => {
              close();
              onOpenAccounts();
            }}
          />
        )}
      </div>

      <Sheet open={confirmClose} onClose={() => setConfirmClose(false)} elevated>
        <div className="stack center">
          <h2 className="title3">{t('capture.discardTitle')}</h2>
          <p className="subhead secondary" style={{ margin: 0 }}>{t('capture.discardText')}</p>
          <button className="btn danger" onClick={close}>
            {t('capture.discard')}
          </button>
          <button className="btn gray" onClick={() => setConfirmClose(false)}>
            {t('capture.keep')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
