export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Расстояние по прямой, метры. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function withinRadius(p: LatLon, center: LatLon, radiusM: number): boolean {
  return distanceM(p, center) <= radiusM;
}

/**
 * Оценка времени в пути без сервиса маршрутов: дороги извилистее прямой (×1.4),
 * средняя скорость по Петроградке днём ~20 км/ч, плюс минута на парковку.
 * Используется, когда OSRM недоступен, и в планировщике.
 */
export function estimateDriveMin(a: LatLon, b: LatLon): number {
  const meters = distanceM(a, b) * 1.4;
  return Math.round(meters / (20_000 / 60) + 1);
}
