// Отслеживание по ссылке: без входа, только статус, шкала шагов и машина на карте. Телефонов и адресов нет.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { groupTrips, tripState, currentTarget, type Trip } from '../lib/trips';
import { Avatar, Steps, Tag } from '../components/ui';
import { MiniMap } from '../components/MiniMap';
import { LiveFreshness } from '../components/LiveFreshness';
import type { ParentDay } from '@shared/api';
import { addMinutes, localTime } from '@shared/time';

export function Track() {
  const { token = '' } = useParams();
  const [day, setDay] = useState<ParentDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDay(await api.get<ParentDay>(`/track/${encodeURIComponent(token)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Нет связи. Обновим автоматически.');
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 8000);
    return () => window.clearInterval(t);
  }, [load]);

  const trips = useMemo(() => groupTrips(day?.rides ?? []), [day]);
  const featured = useMemo(() => {
    const live = trips.find((t) => tripState(t).live);
    if (live) return live;
    const now = addMinutes(localTime(), -30);
    return trips.find((t) => !tripState(t).done && !tripState(t).cancelled && t.pickupTime >= now) ?? [...trips].reverse().find((t) => tripState(t).done) ?? null;
  }, [trips]);

  return (
    <div className="app">
      <main className="page" style={{ paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
        <div className="page-head">
          <div className="wordmark" style={{ padding: 0, color: 'var(--navy)' }}>
            НА<i />МЕСТЕ
          </div>
          <span className="page-sub">{day?.dayLabel}</span>
        </div>
        {error && !day && <div className="note error">{error}</div>}
        {!day && !error && <div className="empty">Загрузка…</div>}
        {day && !featured && <div className="card empty">Сегодня поездок нет</div>}
        {day && featured && <TrackCard trip={featured} day={day} token={token} />}
        {day && trips.length > 1 && (
          <>
            <div className="section-label">Все поездки сегодня</div>
            <ul className="list">
              {trips.map((t) => {
                const s = tripState(t);
                return (
                  <li key={t.key} className={`row${s.cancelled ? ' cancelled' : ''}`} style={{ cursor: 'default' }}>
                    <time>{t.pickupTime}</time>
                    <span className="main">
                      <b>{t.rides.map((r) => r.child.firstName).join(', ')}</b>
                      <small>
                        {t.fromName} → {[...new Set(t.rides.map((r) => r.to.name))].join(', ')}
                      </small>
                    </span>
                    <Tag tone={s.tone}>{s.done ? 'на месте' : s.cancelled ? 'отменена' : s.live ? 'сейчас' : 'план'}</Tag>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="page-sub" style={{ margin: 0 }}>
          Страница обновляется сама. Ссылка работает только сегодня.
        </p>
      </main>
    </div>
  );
}

function TrackCard({ trip, day, token }: { trip: Trip; day: ParentDay; token: string }) {
  const s = tripState(trip);
  const driver = trip.rides.find((r) => r.driver)?.driver ?? null;
  const target = currentTarget(trip);
  const position = s.live ? (day.live?.position ?? null) : null;
  return (
    <>
      <section className={`live${s.live || s.tone === 'ok' ? '' : ' idle'}${s.tone === 'alert' ? ' alert' : ''}`} aria-live="polite">
        <div className="live-top">
          <span>{s.label}</span>
          {s.eta && <b>≈ {s.eta}</b>}
        </div>
        <div className="live-big">{s.headline}</div>
        <div className="live-lines">
          {s.lines.map((l) => (
            <div className="live-line" key={l.ride.id}>
              <Avatar child={l.ride.child} size={22} />
              <span>
                <b>{l.ride.child.firstName}</b> — {l.text}
              </span>
            </div>
          ))}
        </div>
        {!s.cancelled && <Steps step={s.step} />}
      </section>
      {position && (
        <>
          <MiniMap car={position} target={{ lat: target.lat, lon: target.lon, name: target.name }} routeToken={token} height={240} />
          <LiveFreshness at={position.at} />
        </>
      )}
      {driver && (
        <div className="card driver-row">
          <span className="driver-ava">{driver.name.slice(0, 2).toUpperCase()}</span>
          <span className="who">
            <b>{driver.name}</b>
            <small>
              {driver.vehicle} · {driver.plate}
            </small>
          </span>
        </div>
      )}
    </>
  );
}
