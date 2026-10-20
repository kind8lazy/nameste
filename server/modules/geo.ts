// Бесплатные открытые сервисы: OSRM (время в пути) и Nominatim (поиск адреса) на данных OpenStreetMap.
// Пробок они не знают, поэтому время днём и в час пик умножаем на поправку.
// Если сервис не ответил, считаем по прямой (shared/geo.ts) — поездка от этого не ломается.
import { config } from '../config';
import { estimateDriveMin, type LatLon } from '../../shared/geo';

const routeCache = new Map<string, { min: number; until: number }>();

function trafficFactor(at = new Date()): number {
  const h = (at.getUTCHours() + 3) % 24; // Петербург
  if ((h >= 8 && h < 10) || (h >= 17 && h < 20)) return 1.7;
  if (h >= 10 && h < 17) return 1.4;
  return 1.15;
}

const key = (p: LatLon) => `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`;

/** Минуты в пути на машине с поправкой на время суток. */
export async function driveMinutes(from: LatLon, to: LatLon, at = new Date()): Promise<number> {
  const k = `${key(from)};${key(to)}`;
  const cached = routeCache.get(k);
  let base: number | null = cached && cached.until > Date.now() ? cached.min : null;
  if (base === null) {
    try {
      const res = await fetch(`${config.osrmUrl}/route/v1/driving/${k}?overview=false`, {
        headers: { 'User-Agent': config.userAgent },
        signal: AbortSignal.timeout(4000),
      });
      const data = (await res.json()) as { code: string; routes?: { duration: number }[] };
      if (data.code === 'Ok' && data.routes?.[0]) {
        base = data.routes[0].duration / 60;
        routeCache.set(k, { min: base, until: Date.now() + 86_400_000 });
      }
    } catch {
      // сервис недоступен — ниже посчитаем по прямой
    }
  }
  if (base === null) return estimateDriveMin(from, to);
  return Math.max(1, Math.round(base * trafficFactor(at) + 1));
}

export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

// Nominatim разрешает не больше одного запроса в секунду — выстраиваем очередь
let lastCall = 0;
const geoCache = new Map<string, GeocodeResult[]>();

/** «пр. Динамо 14» → «проспект Динамо 14»: поиск адресов не понимает сокращений. */
export function expandAddress(raw: string): string {
  const rules: [RegExp, string][] = [
    [/(^|[\s,])(пр-т|просп|пр)\.?(?=\s)/gi, '$1проспект'],
    [/(^|[\s,])ул\.?(?=\s)/gi, '$1улица'],
    [/(^|[\s,])наб\.?(?=\s)/gi, '$1набережная'],
    [/(^|[\s,])пер\.?(?=\s)/gi, '$1переулок'],
    [/(^|[\s,])б-р\.?(?=\s)/gi, '$1бульвар'],
    [/(^|[\s,])ш\.?(?=\s)/gi, '$1шоссе'],
    [/(^|[\s,])пл\.?(?=\s)/gi, '$1площадь'],
    [/(^|[\s,])(д|дом)\.?\s+(?=\d)/gi, '$1'],
  ];
  return rules.reduce((s, [re, to]) => s.replace(re, to), raw).replace(/\s+/g, ' ').trim();
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = expandAddress(query);
  if (q.length < 3) return [];
  const cached = geoCache.get(q.toLowerCase());
  if (cached) return cached;
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'ru',
    'accept-language': 'ru',
    viewbox: '29.9,60.1,30.6,59.8', // Петербург
    bounded: '0',
    addressdetails: '0',
  });
  let res: Response;
  try {
    res = await fetch(`${config.nominatimUrl}/search?${params}`, {
      headers: { 'User-Agent': config.userAgent },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return []; // сервис адресов недоступен — диспетчер увидит «ничего не найдено»
  }
  if (!res.ok) return [];
  const rows = (await res.json()) as { name?: string; display_name: string; lat: string; lon: string }[];
  if (!rows.length) return []; // «ничего не нашли» не запоминаем: адрес могут поправить
  const out = rows.map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    address: r.display_name.split(', ').slice(0, 4).join(', '),
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
  geoCache.set(q.toLowerCase(), out);
  return out;
}

/** Линия маршрута по улицам (для демо и карты). Если сервис недоступен — прямая. */
export async function routePath(from: LatLon, to: LatLon): Promise<LatLon[]> {
  try {
    const res = await fetch(`${config.osrmUrl}/route/v1/driving/${key(from)};${key(to)}?overview=full&geometries=geojson`, {
      headers: { 'User-Agent': config.userAgent },
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { code: string; routes?: { geometry: { coordinates: [number, number][] } }[] };
    const coords = data.routes?.[0]?.geometry.coordinates;
    if (data.code === 'Ok' && coords?.length) return coords.map(([lon, lat]) => ({ lat, lon }));
  } catch {
    // ниже — прямая
  }
  return [from, to];
}
