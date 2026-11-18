import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { formatNumber, t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { MapView, type BaseLayer, type MapHandle } from '../../components/MapView';
import { haptic, toast } from '../../components/ui';
import { bearing, distance, midpoint, offset, type LatLon } from '../../lib/geo';
import { enableCompass, getLocationState } from '../../lib/location';

export interface TraceLine {
  a: LatLon; // extrémité amont
  b: LatLon; // extrémité aval (sens d'écoulement a → b)
}

const DEFAULT_LENGTH = 3;
const MAX_LENGTH = 30;
const MIN_LENGTH = 0.3;

export function defaultLine(center: LatLon, heading = 90, length = DEFAULT_LENGTH): TraceLine {
  return { a: offset(center, heading + 180, length / 2), b: offset(center, heading, length / 2) };
}

/**
 * Tracé d'un caniveau à grille sur la photo aérienne : deux poignées à placer sur
 * les extrémités de la grille, et une flèche indiquant le sens d'écoulement.
 */
export function TraceStep({ center, initial, onDone }: { center: LatLon; initial?: TraceLine; onDone: (line: TraceLine) => void }) {
  const [line, setLine] = useState<TraceLine>(() => initial || defaultLine(center));
  const [layer, setLayer] = useState<BaseLayer>('ortho');
  const mapRef = useRef<MapHandle>(null);
  const layers = useRef<{ casing: L.Polyline; main: L.Polyline; arrow: L.Marker; ha: L.Marker; hb: L.Marker } | null>(null);
  const lineRef = useRef(line);
  lineRef.current = line;

  const arrowIcon = (deg: number) =>
    L.divIcon({
      className: '',
      html: `<div class="trace-arrow" style="transform: rotate(${deg}deg)"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 3 20 15h-5v6H9v-6H4z" fill="#fff" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
  const handleIcon = (label: string) =>
    L.divIcon({ className: '', html: `<div class="trace-handle" aria-label="${label}"></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });

  // Création des couches de tracé sur la carte.
  useEffect(() => {
    const map = mapRef.current?.map();
    if (!map) return;
    const { a, b } = lineRef.current;
    const pts = (l: TraceLine): L.LatLngTuple[] => [
      [l.a.lat, l.a.lon],
      [l.b.lat, l.b.lon],
    ];
    const casing = L.polyline(pts({ a, b }), { color: '#ffffff', weight: 13, opacity: 0.95, lineCap: 'round', interactive: false }).addTo(map);
    const main = L.polyline(pts({ a, b }), { color: '#00a588', weight: 7, lineCap: 'round', interactive: false }).addTo(map);
    const mid = midpoint(a, b);
    const arrow = L.marker([mid.lat, mid.lon], { icon: arrowIcon(bearing(a, b)), interactive: false, keyboard: false }).addTo(map);
    const ha = L.marker([a.lat, a.lon], { icon: handleIcon(t('trace.handleStart')), draggable: true, autoPan: true }).addTo(map);
    const hb = L.marker([b.lat, b.lon], { icon: handleIcon(t('trace.handleEnd')), draggable: true, autoPan: true }).addTo(map);
    const live = () => {
      const pa = ha.getLatLng();
      const pb = hb.getLatLng();
      const l = { a: { lat: pa.lat, lon: pa.lng }, b: { lat: pb.lat, lon: pb.lng } };
      casing.setLatLngs(pts(l));
      main.setLatLngs(pts(l));
      const m = midpoint(l.a, l.b);
      arrow.setLatLng([m.lat, m.lon]).setIcon(arrowIcon(bearing(l.a, l.b)));
      return l;
    };
    ha.on('drag', live);
    hb.on('drag', live);
    ha.on('dragend', () => setLine(live()));
    hb.on('dragend', () => setLine(live()));
    layers.current = { casing, main, arrow, ha, hb };
    return () => {
      [casing, main, arrow, ha, hb].forEach((x) => x.remove());
      layers.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mise à jour après « Inverser » ou « Aligner ».
  useEffect(() => {
    const ls = layers.current;
    if (!ls) return;
    const pts: L.LatLngTuple[] = [
      [line.a.lat, line.a.lon],
      [line.b.lat, line.b.lon],
    ];
    ls.casing.setLatLngs(pts);
    ls.main.setLatLngs(pts);
    ls.ha.setLatLng(pts[0]);
    ls.hb.setLatLng(pts[1]);
    const m = midpoint(line.a, line.b);
    ls.arrow.setLatLng([m.lat, m.lon]).setIcon(arrowIcon(bearing(line.a, line.b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line]);

  const length = distance(line.a, line.b);
  const tooLong = length > MAX_LENGTH;
  const tooShort = length < MIN_LENGTH;

  const align = async () => {
    haptic();
    await enableCompass();
    // Laisse le temps à la boussole d'envoyer une première mesure.
    let heading = getLocationState().heading;
    for (let i = 0; i < 6 && heading === null; i++) {
      await new Promise((r) => setTimeout(r, 150));
      heading = getLocationState().heading;
    }
    if (heading === null) {
      toast(t('trace.noCompass'), 'compass', 'var(--orange)');
      return;
    }
    const c = midpoint(line.a, line.b);
    setLine(defaultLine(c, heading, Math.max(length, 1)));
    haptic('success');
  };

  return (
    <div className="locate">
      <div className="locate-map">
        <MapView ref={mapRef} center={midpoint(line.a, line.b)} zoom={21} layer={layer} />
        <div className="map-buttons">
          <button className="icon-btn" onClick={() => setLayer(layer === 'ortho' ? 'plan' : 'ortho')} aria-label={t('map.toggleLayer')}>
            <Icon name="layers" />
          </button>
        </div>
      </div>
      <div className="locate-panel">
        <div className="stack slide-in">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h2 className="title3">{t('trace.title')}</h2>
              <p className="subhead secondary" style={{ margin: '4px 0 0' }}>{t('trace.hint')}</p>
            </div>
            <span className={`chip ${tooLong || tooShort ? 'red' : 'accent'}`} role="status" style={{ marginTop: 2 }}>
              {t('trace.length', { m: formatNumber(length, 1) })}
            </span>
          </div>
          {(tooLong || tooShort) && (
            <p className="footnote" style={{ margin: 0, color: 'var(--red)' }}>{tooLong ? t('trace.tooLong', { max: MAX_LENGTH }) : t('trace.tooShort')}</p>
          )}
          <div className="btn-row">
            <button className="btn gray small" style={{ flex: 1, width: 'auto' }} onClick={align}>
              <Icon name="compass" size={18} /> {t('trace.align')}
            </button>
            <button
              className="btn gray small"
              style={{ flex: 1, width: 'auto' }}
              onClick={() => {
                haptic();
                setLine({ a: line.b, b: line.a });
              }}
            >
              <Icon name="swap" size={18} /> {t('trace.reverse')}
            </button>
          </div>
          <p className="footnote secondary" style={{ margin: 0 }}>{t('trace.flowHint')}</p>
          <button className="btn" disabled={tooLong || tooShort} onClick={() => onDone(line)}>
            {t('trace.validate')}
          </button>
        </div>
      </div>
    </div>
  );
}
