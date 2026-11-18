import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getConfig } from '../lib/config';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { MapView, type BaseLayer, type MapHandle, type MapLine, type MapMarker } from '../components/MapView';
import { Ring, Sheet } from '../components/ui';
import { distance, type LatLon } from '../lib/geo';
import { useLocation } from '../lib/location';
import { cachedNearbyDrains, fetchNearbyDrains, type OsmDrain } from '../lib/overpass';
import { useAuth, useProgress, useRecords } from '../lib/store';
import { useSyncState } from '../lib/sync';
import { needsSync } from '../lib/gamification';
import { typeFromTags } from '../lib/taxonomy';
import { osmElementUrl } from '../lib/osm';
import { recordCenter } from '../lib/export';
import { panoramaxReady, pictureThumbUrl, pictureViewerUrl } from '../lib/panoramax';
import { RecordDetail } from './RecordDetail';

const DEFAULT_CENTER: LatLon = { lat: 46.6, lon: 2.4 };

export function MapScreen({ onAdd, onOpenProfile, onOpenAccounts }: { onAdd: () => void; onOpenProfile: () => void; onOpenAccounts: () => void }) {
  const records = useRecords() || [];
  const progress = useProgress();
  const loc = useLocation(true);
  const auth = useAuth();
  const sync = useSyncState();
  const [layer, setLayer] = useState<BaseLayer>('plan');
  const [nearby, setNearby] = useState<OsmDrain[]>([]);
  const [selected, setSelected] = useState<{ kind: 'osm'; drain: OsmDrain } | { kind: 'mine'; id: string } | null>(null);
  const [following, setFollowing] = useState(true);
  const mapRef = useRef<MapHandle>(null);
  const lastFetch = useRef<LatLon | null>(null);
  const startCenter = useRef<LatLon>(records[0]?.position || DEFAULT_CENTER);

  useEffect(() => {
    void cachedNearbyDrains().then((c) => {
      if (!c) return;
      setNearby(c.drains);
      if (!records.length && !loc.fix) mapRef.current?.map()?.setView([c.center.lat, c.center.lon], 17);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Centrage sur l'utilisateur (tant qu'il n'a pas déplacé la carte).
  useEffect(() => {
    if (!loc.fix || !following) return;
    const map = mapRef.current?.map();
    if (!map) return;
    map.setView([loc.fix.lat, loc.fix.lon], Math.max(map.getZoom(), 18), { animate: true });
  }, [loc.fix, following]);

  const loadAround = useCallback((c: LatLon, zoom: number) => {
    if (zoom < 15.5) return;
    if (lastFetch.current && distance(lastFetch.current, c) < 200) return;
    lastFetch.current = c;
    fetchNearbyDrains(c, 600)
      .then(setNearby)
      .catch(() => undefined);
  }, []);

  const mineKeys = useMemo(
    () =>
      new Set(
        records.flatMap((r) => [
          ...(r.sync.osm.osmId ? [`${r.sync.osm.osmType ?? 'node'}:${r.sync.osm.osmId}`] : []),
          ...(r.osmTarget ? [`${r.osmTarget.type ?? 'node'}:${r.osmTarget.id}`] : []),
        ]),
      ),
    [records],
  );

  const markers: MapMarker[] = useMemo(
    () => [
      ...nearby
        .filter((d) => !mineKeys.has(`${d.type ?? 'node'}:${d.id}`))
        .map((d) => ({ id: `osm:${d.type ?? 'node'}:${d.id}`, lat: d.lat, lon: d.lon, kind: 'osm' as const })),
      ...records.map((r) => {
        const c = recordCenter(r);
        return { id: `mine:${r.id}`, lat: c.lat, lon: c.lon, kind: needsSync(r) ? ('pending' as const) : ('mine' as const) };
      }),
    ],
    [nearby, records, mineKeys],
  );

  // Caniveaux à grille : tracés en ligne.
  const lines: MapLine[] = useMemo(
    () => [
      ...nearby
        .filter((d) => d.geometry && !mineKeys.has(`way:${d.id}`))
        .map((d) => ({ id: `osm-line:${d.id}`, points: d.geometry!, kind: 'osm' as const })),
      ...records
        .filter((r) => r.line)
        .map((r) => ({ id: `mine-line:${r.id}`, points: [r.line!.a, r.line!.b], kind: needsSync(r) ? ('pending' as const) : ('mine' as const) })),
    ],
    [nearby, records, mineKeys],
  );

  const onMarkerClick = useCallback(
    (id: string) => {
      const [kind, a, b] = id.split(':');
      if (kind === 'osm') {
        const drain = nearby.find((d) => (d.type ?? 'node') === a && String(d.id) === b);
        if (drain) setSelected({ kind: 'osm', drain });
      } else setSelected({ kind: 'mine', id: a });
    },
    [nearby],
  );

  const goal = getConfig().dailyGoal;
  const pending = progress.pending;
  const connected = !!auth.osm && panoramaxReady();

  return (
    <div className="map-screen">
      <MapView
        ref={mapRef}
        center={loc.fix || startCenter.current}
        zoom={loc.fix || records.length ? 18 : 6}
        layer={layer}
        markers={markers}
        lines={lines}
        user={loc.fix}
        onMarkerClick={onMarkerClick}
        onMoveEnd={loadAround}
        onDragStart={() => setFollowing(false)}
      />

      <div className="map-top">
        <button className="hud" onClick={onOpenProfile} aria-label={t('map.hudLabel')}>
          <Ring progress={Math.min(1, progress.today / goal)} size={44} width={5.5} color="var(--orange)">
            <span className="caption rounded-num" style={{ fontWeight: 700 }}>
              {progress.today}/{goal}
            </span>
          </Ring>
          <div className="hud-text">
            <span className="hud-level">{t(`levels.${progress.level.level}`)}</span>
            <span className="hud-points rounded-num">
              {progress.points} {t('common.pts')}
            </span>
          </div>
          <span className="hud-streak" title={t('profile.streak')}>
            <Icon name="flame" size={18} fill style={{ color: progress.streak ? 'var(--orange)' : 'var(--label-3)' }} />
            <span className="rounded-num">{progress.streak}</span>
          </span>
        </button>

        {sync.running ? (
          <div className="sync-pill slide-in" role="status">
            <Icon name="sync" size={16} className="spin" />
            {t('sync.running', { done: sync.done, total: sync.total })}
          </div>
        ) : pending > 0 && !connected ? (
          <button className="sync-pill warn slide-in" onClick={onOpenAccounts}>
            <Icon name="cloudUp" size={16} />
            {t('sync.pendingConnect', { count: pending })}
          </button>
        ) : null}
      </div>

      <div className="map-buttons">
        <button className="icon-btn" onClick={() => setLayer(layer === 'plan' ? 'ortho' : 'plan')} aria-label={t('map.toggleLayer')}>
          <Icon name="layers" />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            setFollowing(true);
            if (loc.fix) mapRef.current?.flyTo(loc.fix, 18.5);
          }}
          aria-label={t('map.recenter')}
        >
          <Icon name="arrow" fill={following} stroke={1.6} style={{ color: 'var(--blue)' }} />
        </button>
      </div>

      <div className="map-legend" aria-hidden="true">
        <span><i style={{ background: '#5e5ce6' }} />{t('map.legendOsm')}</span>
        <span><i style={{ background: '#00a588' }} />{t('map.legendMine')}</span>
        <span><i style={{ background: '#ff9500' }} />{t('map.legendPending')}</span>
      </div>

      <button className="fab" onClick={onAdd}>
        <Icon name="plus" size={24} stroke={2.8} />
        {t('map.add')}
      </button>

      <Sheet open={selected?.kind === 'osm'} onClose={() => setSelected(null)} title={selected?.kind === 'osm' ? t(`types.${typeFromTags(selected.drain.tags)}.name`) : ''} elevated>
        {selected?.kind === 'osm' && <OsmDrainDetail drain={selected.drain} onAdd={() => { setSelected(null); onAdd(); }} />}
      </Sheet>
      <Sheet open={selected?.kind === 'mine'} onClose={() => setSelected(null)} title={t('records.detailTitle')}>
        {selected?.kind === 'mine' && <RecordDetail id={selected.id} onDeleted={() => setSelected(null)} />}
      </Sheet>
    </div>
  );
}

function OsmDrainDetail({ drain, onAdd }: { drain: OsmDrain; onAdd: () => void }) {
  const photo = drain.tags.panoramax;
  return (
    <div className="stack">
      {photo ? (
        <a href={pictureViewerUrl(photo)} target="_blank" rel="noopener" className="osm-photo">
          <img src={pictureThumbUrl(photo)} alt={t('records.photoAlt')} loading="lazy" />
        </a>
      ) : (
        <div className="card row" style={{ background: 'var(--accent-tint)' }}>
          <Icon name="camera" style={{ color: 'var(--accent)', flex: 'none' }} />
          <span className="footnote">{t('map.noPhoto')}</span>
        </div>
      )}
      <pre className="tags-code selectable" style={{ borderRadius: 12 }}>
        {Object.entries(drain.tags).map(([k, v]) => `${k}=${v}`).join('\n')}
      </pre>
      {!photo && (
        <button className="btn" onClick={onAdd}>
          <Icon name="camera" /> {t('map.addPhoto')}
        </button>
      )}
      <a className="btn gray" href={osmElementUrl(drain.type ?? 'node', drain.id)} target="_blank" rel="noopener">
        <Icon name="external" size={18} /> {t('map.viewOnOsm')}
      </a>
    </div>
  );
}
