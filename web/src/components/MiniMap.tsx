// Карта на открытых данных OpenStreetMap (OpenFreeMap) — бесплатно, без ключей.
// Золотая точка — машина с ребёнком, тёмная — куда едем.
import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MLMap, Marker, GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';

interface Pt {
  lat: number;
  lon: number;
}

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const PADDING = { top: 36, bottom: 36, left: 36, right: 36 };

function dot(color: string, size: number, halo = false) {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;${halo ? 'box-shadow:0 0 0 6px rgba(184,150,79,.3);' : ''}`;
  return el;
}

function boundsOf(pts: Pt[]): LngLatBoundsLike | null {
  if (pts.length < 2) return null;
  const lons = pts.map((p) => p.lon);
  const lats = pts.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

const metersBetween = (a: Pt, b: Pt) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

/** routeToken — для страницы по ссылке отслеживания, где нет входа: им сервер разрешает построить маршрут. */
export function MiniMap({ car, target, height = 190, routeToken }: { car: Pt | null; target: (Pt & { name: string }) | null; height?: number; routeToken?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ml = useRef<typeof import('maplibre-gl') | null>(null);
  const carMarker = useRef<Marker | null>(null);
  const targetMarker = useRef<Marker | null>(null);
  const latest = useRef({ car, target });
  latest.current = { car, target };
  // маршрут по улицам: перестраиваем, когда машина отъехала на 250 м или сменилась цель
  const route = useRef<{ from: Pt; to: Pt; coords: [number, number][] } | null>(null);

  const draw = (animate: boolean) => {
    const m = map.current;
    const lib = ml.current;
    if (!m || !lib) return;
    const { car: c, target: t } = latest.current;
    if (c) {
      carMarker.current ??= new lib.Marker({ element: dot('#B8964F', 18, true) }).setLngLat([c.lon, c.lat]).addTo(m);
      carMarker.current.setLngLat([c.lon, c.lat]);
    }
    if (t) {
      targetMarker.current ??= new lib.Marker({ element: dot('#1B3440', 14) }).setLngLat([t.lon, t.lat]).addTo(m);
      targetMarker.current.setLngLat([t.lon, t.lat]);
    }
    const street = c && t && route.current && metersBetween(route.current.to, t) < 30 ? route.current.coords : null;
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: street ? [[c!.lon, c!.lat], ...street] : c && t ? [[c.lon, c.lat], [t.lon, t.lat]] : [] },
    };
    const src = m.getSource('route') as GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      m.addSource('route', { type: 'geojson', data });
      m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1B3440', 'line-width': 4, 'line-opacity': 0.6 } });
    }
    // пока маршрута по улицам нет — пунктир «по прямой»
    m.setPaintProperty('route', 'line-dasharray', street ? [1, 0] : [1.5, 1.5]);
    const b = boundsOf([c, t].filter(Boolean) as Pt[]);
    if (b) m.fitBounds(b, { padding: PADDING, maxZoom: 15, duration: animate ? 600 : 0 });
    else if (c ?? t) m.easeTo({ center: [(c ?? t)!.lon, (c ?? t)!.lat], zoom: 14, duration: animate ? 600 : 0 });
  };

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((lib) => {
      if (cancelled || !box.current || map.current) return;
      ml.current = lib;
      const { car: c, target: t } = latest.current;
      const pts = [c, t].filter(Boolean) as Pt[];
      const b = boundsOf(pts);
      const center = pts[0] ?? { lat: 59.964, lon: 30.28 };
      const m = new lib.Map({
        container: box.current,
        style: STYLE,
        ...(b ? { bounds: b, fitBoundsOptions: { padding: PADDING, maxZoom: 15 } } : { center: [center.lon, center.lat] as [number, number], zoom: 14 }),
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      m.touchZoomRotate.disableRotation();
      map.current = m;
      // контейнер может поменять размер после запуска (раскладка страницы) — подстраиваем карту
      const ro = new ResizeObserver(() => m.resize());
      ro.observe(box.current);
      m.once('remove', () => ro.disconnect());
      m.on('load', () => {
        // подписи на русском, где они есть в OpenStreetMap
        for (const layer of m.getStyle().layers ?? []) {
          if (layer.type !== 'symbol') continue;
          try {
            if (m.getLayoutProperty(layer.id, 'text-field')) m.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ru'], ['get', 'name']]);
          } catch {
            // слой с особой подписью (номер дороги и т. п.) оставляем как есть
          }
        }
        m.resize();
        draw(false);
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      carMarker.current = null;
      targetMarker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current?.loaded()) draw(true);
    if (!car || !target) return;
    const r = route.current;
    if (r && metersBetween(r.to, target) < 30 && metersBetween(r.from, car) < 250) return;
    let cancelled = false;
    const q = new URLSearchParams({ from: `${car.lat},${car.lon}`, to: `${target.lat},${target.lon}` });
    if (routeToken) q.set('t', routeToken);
    fetch(`/api/route?${q}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: { coords?: [number, number][] } | null) => {
        if (cancelled || !d?.coords || d.coords.length < 2) return;
        route.current = { from: car, to: target, coords: d.coords };
        if (map.current?.loaded()) draw(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.lat, car?.lon, target?.lat, target?.lon]);

  return (
    <div className="map-wrap" style={{ height }}>
      <div ref={box} className="map" style={{ height }} role="img" aria-label={target ? `Карта: машина и точка «${target.name}»` : 'Карта'} />
      <a className="map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap · OpenFreeMap
      </a>
    </div>
  );
}
