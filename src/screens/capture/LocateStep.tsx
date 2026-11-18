import { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { MapView, type BaseLayer, type MapHandle, type MapLine, type MapMarker } from '../../components/MapView';
import { haptic, Ring, Sheet, Spinner, toast } from '../../components/ui';
import { accuracyLevel, averageFixes, distance, distanceToLine, type GpsSample, type LatLon } from '../../lib/geo';
import { getLocationState, onSample, useLocation } from '../../lib/location';
import { distanceToDrain, type OsmDrain } from '../../lib/overpass';
import type { DrainRecord } from '../../lib/db';
import { typeFromTags } from '../../lib/taxonomy';

const MEASURE_MS = 6000;
const FALLBACK: LatLon = { lat: 46.6, lon: 2.4 };

export interface LocateResult {
  position: DrainRecord['position'];
  enrich?: OsmDrain;
}

type Phase = 'approach' | 'measuring' | 'adjust';

const LEVEL_COLOR = { excellent: 'var(--green)', good: 'var(--green)', fair: 'var(--orange)', poor: 'var(--red)' };

export function LocateStep({
  nearby,
  myRecords,
  onDone,
}: {
  nearby: OsmDrain[];
  myRecords: DrainRecord[];
  onDone: (r: LocateResult) => void;
}) {
  const loc = useLocation(true);
  const [phase, setPhase] = useState<Phase>('approach');
  const [layer, setLayer] = useState<BaseLayer>('ortho');
  const [fix, setFix] = useState<{ lat: number; lon: number; acc: number; samples: number } | null>(null);
  const [center, setCenter] = useState<LatLon | null>(null);
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);
  const [duplicate, setDuplicate] = useState<{ kind: 'osm'; drain: OsmDrain; d: number } | { kind: 'mine'; d: number } | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const samples = useRef<GpsSample[]>([]);
  const centered = useRef(false);

  // Pendant l'approche, la carte suit l'utilisateur.
  useEffect(() => {
    if (phase !== 'approach' || !loc.fix) return;
    const map = mapRef.current?.map();
    if (!map) return;
    if (!centered.current) {
      map.setView([loc.fix.lat, loc.fix.lon], 20, { animate: false });
      centered.current = true;
    } else {
      map.panTo([loc.fix.lat, loc.fix.lon], { animate: true, duration: 0.5 });
    }
  }, [loc.fix, phase]);

  const markers: MapMarker[] = useMemo(
    () => [
      ...nearby.map((d) => ({ id: `osm-${d.type}-${d.id}`, lat: d.lat, lon: d.lon, kind: 'osm' as const })),
      ...myRecords
        .filter((r) => r.mode === 'new')
        .map((r) => ({ id: r.id, lat: r.position.lat, lon: r.position.lon, kind: 'mine' as const })),
    ],
    [nearby, myRecords],
  );

  const lines: MapLine[] = useMemo(
    () => [
      ...nearby.filter((d) => d.geometry).map((d) => ({ id: `osm-way-${d.id}`, points: d.geometry!, kind: 'osm' as const })),
      ...myRecords.filter((r) => r.line).map((r) => ({ id: r.id, points: [r.line!.a, r.line!.b], kind: 'mine' as const })),
    ],
    [nearby, myRecords],
  );

  const startMeasure = () => {
    haptic();
    // Le GPS n'émet parfois pas de nouvelle mesure quand on est immobile : on part de la dernière connue.
    samples.current = loc.fix && Date.now() - loc.fix.t < 60_000 ? [loc.fix] : [];
    setCount(samples.current.length);
    setPhase('measuring');
  };

  useEffect(() => {
    if (phase !== 'measuring') return;
    const unsub = onSample((s) => {
      samples.current.push(s);
      setCount(samples.current.length);
    });
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / MEASURE_MS);
      setProgress(k);
      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        unsub();
        const last = getLocationState().fix;
        if (!samples.current.length && last) samples.current.push(last);
        const avg = averageFixes(samples.current);
        if (!avg) {
          haptic('warning');
          toast(t('locate.noFix'), 'warning', 'var(--orange)');
          setPhase('approach');
          return;
        }
        haptic('success');
        setFix(avg);
        setCenter({ lat: avg.lat, lon: avg.lon });
        setPhase('adjust');
        mapRef.current?.map()?.setView([avg.lat, avg.lon], 20.5, { animate: true });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [phase]);

  const manualPlacement = () => {
    const c = mapRef.current?.center() || FALLBACK;
    setFix({ lat: c.lat, lon: c.lon, acc: 15, samples: 0 });
    setCenter(c);
    setPhase('adjust');
    mapRef.current?.map()?.setZoom(19.5);
  };

  const moved = fix && center ? distance(fix, center) : 0;
  const tooFar = fix ? moved > Math.max(20, fix.acc * 3) : false;

  const finalPosition = (): DrainRecord['position'] => ({
    lat: center!.lat,
    lon: center!.lon,
    acc: fix!.acc,
    samples: fix!.samples,
    adjusted: moved > 0.3,
    adjustMeters: Math.round(moved * 10) / 10,
  });

  const validate = () => {
    if (!center || !fix) return;
    const radius = Math.max(4, Math.min(fix.acc, 8));
    let best: { drain: OsmDrain; d: number } | null = null;
    for (const d of nearby) {
      const dd = distanceToDrain(center, d);
      if (dd <= radius && (!best || dd < best.d)) best = { drain: d, d: dd };
    }
    if (best) {
      haptic('warning');
      setDuplicate({ kind: 'osm', ...best });
      return;
    }
    const mine = myRecords
      .filter((r) => r.mode === 'new')
      .map((r) => (r.line ? distanceToLine(center, [r.line.a, r.line.b]) : distance(r.position, center)))
      .filter((d) => d <= 2.5)
      .sort((a, b) => a - b)[0];
    if (mine !== undefined) {
      haptic('warning');
      setDuplicate({ kind: 'mine', d: mine });
      return;
    }
    onDone({ position: finalPosition() });
  };

  const level = loc.fix ? accuracyLevel(loc.fix.acc) : null;
  const known = loc.fix || nearby[0] || myRecords[0]?.position;
  const initialCenter = known || FALLBACK;

  return (
    <div className="locate">
      <div className="locate-map">
        <MapView
          ref={mapRef}
          center={initialCenter}
          zoom={known ? 20 : 6}
          layer={layer}
          markers={markers}
          lines={lines}
          user={phase === 'adjust' ? null : loc.fix}
          accuracyCircle={phase === 'adjust' && fix && fix.samples > 0 ? fix : null}
          onMove={phase === 'adjust' ? setCenter : undefined}
        />
        {phase === 'adjust' && (
          <div className="center-pin" aria-hidden="true">
            <svg width="44" height="58" viewBox="0 0 44 58">
              <path d="M22 56s18-17.5 18-33A18 18 0 0 0 4 23c0 15.5 18 33 18 33Z" fill="var(--accent)" stroke="#fff" strokeWidth="3" />
              <rect x="13" y="15" width="18" height="15" rx="2" fill="#fff" />
              <path d="M17 17.5v10M22 17.5v10M27 17.5v10" stroke="var(--accent)" strokeWidth="2" />
            </svg>
            <span className="center-dot" />
          </div>
        )}
        <div className="map-buttons">
          <button
            className="icon-btn"
            onClick={() => setLayer(layer === 'ortho' ? 'plan' : 'ortho')}
            aria-label={t('map.toggleLayer')}
            title={t(layer === 'ortho' ? 'map.plan' : 'map.ortho')}
          >
            <Icon name="layers" />
          </button>
          {phase !== 'adjust' && loc.fix && (
            <button className="icon-btn" onClick={() => mapRef.current?.flyTo(loc.fix!, 20)} aria-label={t('map.recenter')}>
              <Icon name="arrow" fill stroke={1.2} style={{ color: 'var(--blue)' }} />
            </button>
          )}
        </div>
      </div>

      <div className="locate-panel">
        {phase === 'approach' && loc.status === 'denied' && (
          <div className="stack slide-in">
            <div className="row">
              <div className="icon-tile" style={{ background: 'var(--red)' }}>
                <Icon name="location" size={18} />
              </div>
              <h2 className="title3">{t('locate.deniedTitle')}</h2>
            </div>
            <p className="subhead secondary" style={{ margin: 0 }}>{t('locate.deniedText')}</p>
            <button className="btn tinted" onClick={manualPlacement}>
              <Icon name="move" /> {t('locate.manual')}
            </button>
          </div>
        )}

        {phase === 'approach' && loc.status !== 'denied' && (
          <div className="stack slide-in">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <StandOverIllustration />
              <div style={{ flex: 1 }}>
                <h2 className="title3">{t('locate.title')}</h2>
                <p className="subhead secondary" style={{ margin: '4px 0 0' }}>{t('locate.hint')}</p>
              </div>
            </div>
            <div className="accuracy-row" role="status">
              {loc.fix ? (
                <>
                  <span className="accuracy-dot" style={{ background: LEVEL_COLOR[level!] }} />
                  <span className="subhead">
                    {t('locate.accuracy', { m: formatNumber(loc.fix.acc, loc.fix.acc < 10 ? 1 : 0) })}
                  </span>
                  <span className="chip" style={{ marginLeft: 'auto', color: LEVEL_COLOR[level!] }}>
                    {t(`accuracy.${level}`)}
                  </span>
                </>
              ) : (
                <>
                  <Spinner size={18} />
                  <span className="subhead secondary">{t('locate.searching')}</span>
                </>
              )}
            </div>
            <button className="btn" onClick={startMeasure} disabled={!loc.fix}>
              <Icon name="location" /> {t('locate.imOver')}
            </button>
            {loc.fix && loc.fix.acc > 15 && <p className="footnote secondary center" style={{ margin: 0 }}>{t('locate.poorTip')}</p>}
            <button className="btn plain" onClick={manualPlacement} style={{ minHeight: 32 }}>
              {t('locate.manualLink')}
            </button>
          </div>
        )}

        {phase === 'measuring' && (
          <div className="stack center slide-in" style={{ alignItems: 'center' }}>
            <Ring progress={progress} size={92} width={9}>
              <span className="title2 rounded-num">{Math.max(0, Math.ceil((1 - progress) * (MEASURE_MS / 1000)))}</span>
            </Ring>
            <h2 className="title3">{t('locate.holdStill')}</h2>
            <p className="subhead secondary" style={{ margin: 0 }}>{t('locate.measuring', { count })}</p>
            <button className="btn plain" onClick={() => setPhase('approach')}>
              {t('common.cancel')}
            </button>
          </div>
        )}

        {phase === 'adjust' && fix && (
          <div className="stack slide-in">
            <div className="row">
              <span className="chip green">
                <Icon name="check" size={15} stroke={2.6} />
                {fix.samples > 0 ? t('locate.saved', { m: formatNumber(fix.acc, 1) }) : t('locate.manualSaved')}
              </span>
              {moved > 0.3 && (
                <span className={`chip ${tooFar ? 'red' : 'blue'}`} style={{ marginLeft: 'auto' }}>
                  <Icon name="move" size={14} /> {t('locate.moved', { m: formatNumber(moved, 1) })}
                </span>
              )}
            </div>
            <p className="subhead secondary" style={{ margin: 0 }}>
              {tooFar ? t('locate.tooFar') : t('locate.adjustHint')}
            </p>
            <div className="btn-row">
              <button className="btn gray" onClick={() => setPhase('approach')}>
                {t('locate.remeasure')}
              </button>
              <button className="btn" onClick={validate}>
                {t('locate.validate')}
              </button>
            </div>
          </div>
        )}
      </div>

      <Sheet open={!!duplicate} onClose={() => setDuplicate(null)} elevated>
        {duplicate?.kind === 'osm' && (
          <div className="stack">
            <div className="center">
              <div className="dup-badge pop">
                <Icon name="grate" size={30} />
              </div>
              <h2 className="title2" style={{ marginTop: 12 }}>{t('duplicate.title')}</h2>
              <p className="subhead secondary">
                {t('duplicate.text', { m: formatNumber(duplicate.d, 1), type: t(`types.${typeFromTags(duplicate.drain.tags)}.name`) })}
              </p>
            </div>
            <button className="btn" onClick={() => onDone({ position: finalPosition(), enrich: duplicate.drain })}>
              {t('duplicate.same')}
            </button>
            <button className="btn gray" onClick={() => onDone({ position: finalPosition() })}>
              {t('duplicate.different')}
            </button>
            <p className="footnote secondary center" style={{ margin: 0 }}>{t('duplicate.footnote')}</p>
          </div>
        )}
        {duplicate?.kind === 'mine' && (
          <div className="stack">
            <div className="center">
              <div className="dup-badge pop" style={{ background: 'color-mix(in srgb, var(--orange) 18%, transparent)', color: 'var(--orange)' }}>
                <Icon name="warning" size={30} />
              </div>
              <h2 className="title2" style={{ marginTop: 12 }}>{t('duplicate.mineTitle')}</h2>
              <p className="subhead secondary">{t('duplicate.mineText', { m: formatNumber(duplicate.d, 1) })}</p>
            </div>
            <button className="btn" onClick={() => onDone({ position: finalPosition() })}>
              {t('duplicate.mineContinue')}
            </button>
            <button className="btn gray" onClick={() => setDuplicate(null)}>
              {t('common.back')}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** Petite illustration : vue de dessus, deux pieds de part et d'autre d'une grille. */
function StandOverIllustration() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="64" height="64" rx="16" fill="var(--accent-tint)" />
      <rect x="21" y="21" width="22" height="22" rx="3" fill="#4a4d52" />
      <path d="M26 25v14M30 25v14M34 25v14M38 25v14" stroke="#121315" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 20c0-4 2.5-7 5-7s4 3 4 7v12c0 3-2 5-4.5 5S12 35 12 32V20Z" fill="var(--accent)" />
      <path d="M43 20c0-4 1.5-7 4-7s5 3 5 7v12c0 3-2 5-4.5 5S43 35 43 32V20Z" fill="var(--accent)" />
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 4" opacity=".6" />
    </svg>
  );
}
