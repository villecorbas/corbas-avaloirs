import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLon } from '../lib/geo';

/*
 * Garde-fou pour un bogue connu de Leaflet 1.9 : un rafraîchissement du rendu
 * Canvas peut être planifié juste avant la destruction d'une carte et s'exécuter
 * ensuite sur un contexte supprimé. On ignore simplement ce rafraîchissement.
 */
const canvasProto = L.Canvas.prototype as unknown as { _redraw: () => void; _ctx?: CanvasRenderingContext2D; _redrawRequest: number | null };
const originalRedraw = canvasProto._redraw;
canvasProto._redraw = function (this: typeof canvasProto) {
  if (!this._ctx) {
    this._redrawRequest = null;
    return;
  }
  originalRedraw.call(this);
};

export type BaseLayer = 'plan' | 'ortho';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  kind: 'osm' | 'osmNoPhoto' | 'mine' | 'pending' | 'target';
  label?: string;
}

export interface MapLine {
  id: string;
  points: LatLon[];
  /** 'todo' / 'covered' : couverture des rues (rues à explorer / déjà couvertes). */
  kind: MapMarker['kind'] | 'todo' | 'covered';
}

const COVERAGE_STYLE: Record<'todo' | 'covered', L.PolylineOptions> = {
  todo: { color: '#ff7a00', weight: 5, opacity: 0.9, dashArray: '2 9', lineCap: 'round', interactive: false },
  covered: { color: '#34c759', weight: 5, opacity: 0.4, lineCap: 'round', interactive: false },
};

export interface MapHandle {
  map: () => L.Map | null;
  flyTo: (p: LatLon, zoom?: number) => void;
  center: () => LatLon | null;
}

interface Props {
  center: LatLon;
  zoom?: number;
  layer: BaseLayer;
  markers?: MapMarker[];
  /** Caniveaux à grille (lignes). */
  lines?: MapLine[];
  user?: { lat: number; lon: number; acc: number } | null;
  accuracyCircle?: { lat: number; lon: number; acc: number } | null;
  interactive?: boolean;
  onMarkerClick?: (id: string) => void;
  onMoveEnd?: (center: LatLon, zoom: number) => void;
  onMove?: (center: LatLon) => void;
  /** Déplacement de la carte par l'utilisateur (glisser). */
  onDragStart?: () => void;
  className?: string;
}

const LAYERS: Record<BaseLayer, { url: string; options: L.TileLayerOptions }> = {
  plan: {
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    options: {
      subdomains: 'abc',
      maxNativeZoom: 20,
      maxZoom: 22,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · OSM France',
    },
  },
  ortho: {
    url:
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    options: {
      maxNativeZoom: 19,
      maxZoom: 22,
      attribution: '© <a href="https://geoservices.ign.fr" target="_blank" rel="noopener">IGN</a> BD ORTHO · © OpenStreetMap',
    },
  },
};

const STYLE: Record<MapMarker['kind'], L.CircleMarkerOptions> = {
  osm: { radius: 6, color: '#ffffff', weight: 2, fillColor: '#5e5ce6', fillOpacity: 1 },
  osmNoPhoto: { radius: 6, color: '#5e5ce6', weight: 2.5, fillColor: '#ffffff', fillOpacity: 1 },
  mine: { radius: 8, color: '#ffffff', weight: 2.5, fillColor: '#00a588', fillOpacity: 1 },
  pending: { radius: 8, color: '#ffffff', weight: 2.5, fillColor: '#ff9500', fillOpacity: 1 },
  target: { radius: 10, color: '#ffcc00', weight: 4, fillColor: '#5e5ce6', fillOpacity: 1 },
};

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userRef = useRef<{ dot: L.Marker; circle: L.Circle } | null>(null);
  const accRef = useRef<L.Circle | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;

  useImperativeHandle(ref, () => ({
    map: () => mapRef.current,
    flyTo: (p, zoom) => mapRef.current?.flyTo([p.lat, p.lon], zoom ?? mapRef.current.getZoom(), { duration: 0.6 }),
    center: () => {
      const c = mapRef.current?.getCenter();
      return c ? { lat: c.lat, lon: c.lng } : null;
    },
  }));

  // Création de la carte.
  useEffect(() => {
    if (!el.current) return;
    const interactive = props.interactive !== false;
    const map = L.map(el.current, {
      center: [props.center.lat, props.center.lon],
      zoom: props.zoom ?? 18,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      dragging: interactive,
      touchZoom: interactive ? 'center' : false,
      scrollWheelZoom: interactive ? 'center' : false,
      doubleClickZoom: interactive ? 'center' : false,
      boxZoom: false,
      keyboard: interactive,
      maxZoom: 22,
      zoomSnap: 0.5,
    });
    map.attributionControl.setPrefix(false);
    markersRef.current = L.layerGroup().addTo(map);
    map.on('moveend', () => {
      const c = map.getCenter();
      cbRef.current.onMoveEnd?.({ lat: c.lat, lon: c.lng }, map.getZoom());
    });
    map.on('dragstart', () => cbRef.current.onDragStart?.());
    map.on('move', () => {
      const c = map.getCenter();
      cbRef.current.onMove?.({ lat: c.lat, lon: c.lng });
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      // Arrête les animations en cours avant de détruire la carte : sinon la fin
      // différée d'un zoom animé (setTimeout interne de Leaflet) s'exécute sur une
      // carte détruite (bogue connu de Leaflet 1.9).
      map.stop();
      (map as unknown as { _animatingZoom: boolean })._animatingZoom = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fond de carte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    const def = LAYERS[props.layer];
    tileRef.current = L.tileLayer(def.url, { ...def.options, crossOrigin: true }).addTo(map);
  }, [props.layer]);

  // Marqueurs.
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    for (const l of props.lines || []) {
      const pts = l.points.map((p) => [p.lat, p.lon] as L.LatLngTuple);
      if (l.kind === 'todo' || l.kind === 'covered') {
        L.polyline(pts, COVERAGE_STYLE[l.kind]).addTo(group);
        continue;
      }
      const color = (STYLE[l.kind].fillColor === '#ffffff' ? STYLE[l.kind].color : STYLE[l.kind].fillColor) as string;
      L.polyline(pts, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false, lineCap: 'round' }).addTo(group);
      L.polyline(pts, { color, weight: 5, opacity: 1, interactive: false, lineCap: 'round' }).addTo(group);
    }
    for (const m of props.markers || []) {
      const cm = L.circleMarker([m.lat, m.lon], { ...STYLE[m.kind], bubblingMouseEvents: false });
      if (props.onMarkerClick) cm.on('click', () => cbRef.current.onMarkerClick?.(m.id));
      if (m.label) cm.bindTooltip(m.label, { direction: 'top', offset: [0, -8] });
      cm.addTo(group);
    }
  }, [props.markers, props.lines, props.onMarkerClick]);

  // Position de l'utilisateur.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.user) {
      userRef.current?.dot.remove();
      userRef.current?.circle.remove();
      userRef.current = null;
      return;
    }
    const ll: L.LatLngExpression = [props.user.lat, props.user.lon];
    if (!userRef.current) {
      const circle = L.circle(ll, {
        radius: props.user.acc,
        color: '#007aff',
        weight: 1,
        opacity: 0.4,
        fillColor: '#007aff',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
      const dot = L.marker(ll, {
        icon: L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      userRef.current = { dot, circle };
    } else {
      userRef.current.dot.setLatLng(ll);
      userRef.current.circle.setLatLng(ll).setRadius(props.user.acc);
    }
  }, [props.user]);

  // Cercle de précision de la mesure figée.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    accRef.current?.remove();
    accRef.current = null;
    if (props.accuracyCircle) {
      accRef.current = L.circle([props.accuracyCircle.lat, props.accuracyCircle.lon], {
        radius: props.accuracyCircle.acc,
        color: '#ffcc00',
        weight: 2,
        dashArray: '5 5',
        fillColor: '#ffcc00',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
    }
  }, [props.accuracyCircle]);

  return <div ref={el} className={props.className} style={{ width: '100%', height: '100%' }} />;
});
