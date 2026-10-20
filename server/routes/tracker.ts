// Traccar Client (бесплатное приложение в App Store / Google Play) шлёт координаты в фоне.
// Поддерживаем оба формата: старый (параметры в адресе или форма) и новый (JSON).
// Разбор HTML-форм включён только здесь — остальные адреса API форм не принимают.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { driverByTrackerToken, ingestPosition } from '../modules/tracking';

export async function trackerRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const osmand = async (req: FastifyRequest) => {
    const q = { ...(req.query as Record<string, string>), ...((typeof req.body === 'object' && req.body) || {}) } as Record<string, unknown>;
    type Loc = { timestamp?: string; coords?: { latitude: number; longitude: number; speed?: number; heading?: number; accuracy?: number }; battery?: { level?: number } };
    const token = String(q.id ?? q.deviceid ?? q.device_id ?? '');
    const driver = token ? driverByTrackerToken(token) : null;
    if (!driver) return { ok: false };
    const locs: Loc[] = Array.isArray(q.location) ? (q.location as Loc[]) : q.location ? [q.location as Loc] : [];
    if (locs.length) {
      for (const l of locs) {
        if (!l.coords) continue;
        await ingestPosition(
          driver.userId,
          {
            lat: l.coords.latitude,
            lon: l.coords.longitude,
            at: l.timestamp ? new Date(l.timestamp) : undefined,
            speed: l.coords.speed,
            heading: l.coords.heading,
            accuracy: l.coords.accuracy,
            battery: l.battery?.level,
          },
          'tracker',
        );
      }
    } else {
      const ts = q.timestamp ? String(q.timestamp) : '';
      const at = ts ? (/^\d+$/.test(ts) ? new Date(Number(ts) * (ts.length > 11 ? 1 : 1000)) : new Date(ts)) : undefined;
      await ingestPosition(
        driver.userId,
        {
          lat: Number(q.lat),
          lon: Number(q.lon),
          at,
          speed: q.speed != null ? Number(q.speed) * 0.514444 : null, // узлы → м/с
          heading: q.bearing != null ? Number(q.bearing) : null,
          accuracy: q.accuracy != null ? Number(q.accuracy) : null,
          battery: q.batt != null ? Number(q.batt) / 100 : null,
        },
        'tracker',
      );
    }
    return { ok: true };
  };
  app.get('/osmand', osmand);
  app.post('/osmand', osmand);
}
