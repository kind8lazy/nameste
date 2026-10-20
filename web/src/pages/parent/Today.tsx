// Главный экран родителя отвечает на один вопрос: где сейчас ребёнок.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { groupTrips, tripState, currentTarget, type Trip } from '../../lib/trips';
import { phoneHref } from '../../lib/platform';
import { Avatar, Steps, Tag, useToast } from '../../components/ui';
import { MiniMap } from '../../components/MiniMap';
import { PushCard } from '../../components/PushCard';
import { DemoCard } from '../../components/DemoCard';
import { LiveFreshness } from '../../components/LiveFreshness';
import { ShareTracking } from '../../components/ShareTracking';
import { RideSheet } from './RideSheet';
import type { ParentDay, Position, RideView } from '@shared/api';
import { addMinutes, localTime } from '@shared/time';

export function Today() {
  const [day, setDay] = useState<ParentDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [sheet, setSheet] = useState<RideView[] | null>(null);
  const toast = useToast();
  const { me } = useAuth();
  const lite = !!me?.lite;
  const canOrder = !!me?.families.some((f) => f.canEdit) || !!me?.roles.includes('dispatcher');

  const load = useCallback(async () => {
    try {
      const d = await api.get<ParentDay>('/parent/day');
      setDay(d);
      setPosition(d.live?.position ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load(), position: (p) => setPosition(p as Position) });

  const trips = useMemo(() => groupTrips(day?.rides ?? []), [day]);
  const featured = useMemo(() => (lite ? null : pickFeatured(trips)), [trips, lite]);
  const others = trips.filter((t) => t !== featured);

  if (error && !day) return <div className="page"><div className="note error">{error}</div></div>;
  if (!day) return <div className="page"><div className="empty">Загрузка…</div></div>;

  if (me && !me.families.length && !me.roles.includes('dispatcher')) {
    return (
      <main className="page">
        <h1 className="page-title">Здравствуйте, {me.name}</h1>
        <div className="note">
          <b>Вы вошли. Осталось подключить семью.</b>
          <span>Диспетчер НА МЕСТЕ увидит вас и привяжет к вашим детям и поездкам. Обычно это занимает несколько минут в рабочее время.</span>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">Сегодня</h1>
        <span className="page-sub">{day.dayLabel}</span>
      </div>
      {day.children.length > 0 && (
        <div className="kids">
          {day.children.map((c) => (
            <span key={c.id} className={`kid-chip${day.rides.some((r) => r.child.id === c.id && r.tone === 'gold') ? ' on' : ''}`}>
              <Avatar child={c} size={24} />
              {c.firstName}
            </span>
          ))}
        </div>
      )}

      {featured ? <TripCard trip={featured} position={position} onOpen={() => setSheet(featured.rides)} /> : !trips.length && <div className="card empty">Сегодня поездок нет. Расписание — во вкладке «Неделя».</div>}

      {others.length > 0 && (
        <>
          <div className="section-label">{lite ? 'Сегодня' : featured && tripState(featured).done ? 'Сегодня' : 'Дальше сегодня'}</div>
          <ul className="list">
            {others.map((t) => {
              const s = tripState(t);
              return (
                <li key={t.key}>
                  <button className={`row${s.cancelled ? ' cancelled' : ''}`} onClick={() => setSheet(t.rides)}>
                    <time>{t.pickupTime}</time>
                    <span className="main">
                      <b>{t.rides.map((r) => r.child.firstName).join(', ')}</b>
                      <small>
                        {t.fromName} → {[...new Set(t.rides.map((r) => r.to.name))].join(', ')}
                      </small>
                    </span>
                    <Tag tone={s.tone}>{s.done ? 'на месте' : s.cancelled ? 'отменена' : s.live ? 'сейчас' : 'план'}</Tag>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!lite && day.rides.length > 0 && <ShareTracking />}
      <PushCard compact />
      {!lite && <DemoCard />}
      <div className="btn-row">
        {canOrder && (
          <Link to="/app/new" className="btn gold">
            + Новая поездка
          </Link>
        )}
        <Link to="/app/week" className="btn secondary">
          Вся неделя
        </Link>
      </div>
      <RideSheet rides={sheet} onClose={() => setSheet(null)} onDone={(m) => { toast.show(m); void load(); }} />
      {toast.node}
    </main>
  );
}

function pickFeatured(trips: Trip[]): Trip | null {
  if (!trips.length) return null;
  const live = trips.find((t) => tripState(t).live);
  if (live) return live;
  const now = localTime();
  const next = trips.find((t) => {
    const s = tripState(t);
    return !s.done && !s.cancelled && t.pickupTime >= addMinutes(now, -30);
  });
  if (next) return next;
  const done = [...trips].reverse().find((t) => tripState(t).done);
  return done ?? trips[trips.length - 1];
}


function TripCard({ trip, position, onOpen }: { trip: Trip; position: Position | null; onOpen: () => void }) {
  const s = tripState(trip);
  const driver = trip.rides.find((r) => r.driver)?.driver ?? null;
  const target = currentTarget(trip);
  const showMap = s.live && !!position;
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
      {showMap && <MiniMap car={position} target={{ lat: target.lat, lon: target.lon, name: target.name }} />}
      {showMap && position && <LiveFreshness at={position.at} />}
      {driver && (
        <div className="card driver-row">
          <span className="driver-ava">{driver.name.slice(0, 2).toUpperCase()}</span>
          <span className="who">
            <b>{driver.name}</b>
            <small>
              {driver.vehicle} · {driver.plate}
            </small>
          </span>
          {driver.phone && (
            <a className="btn small secondary" href={phoneHref(driver.phone)}>
              Позвонить
            </a>
          )}
        </div>
      )}
      {!s.done && !s.cancelled && (
        <button className="btn secondary block" onClick={onOpen}>
          {s.live ? 'Подробнее' : 'Подтвердить или отменить'}
        </button>
      )}
    </>
  );
}
