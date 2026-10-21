// Смена водителя. За рулём ничего не печатаем: крупные кнопки, свайп для важных действий,
// геозона сама отмечает прибытие, если включён трекер.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { phoneHref, routeHref } from '../../lib/platform';
import { useAuth } from '../../lib/auth';
import { Avatar, SwipeButton, Tag, useToast } from '../../components/ui';
import { PushCard } from '../../components/PushCard';
import { Link } from 'react-router-dom';
import { RoleSwitch } from '../../components/RoleSwitch';
import { plural } from '@shared/ru';
import { Badge, useUnread } from '../../components/Chat';
import type { ShiftView, StopView } from '@shared/api';

const SEAT = { none: '', booster: 'бустер', seat: 'кресло' } as const;

export function Shift() {
  const [shift, setShift] = useState<ShiftView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { me, setMe } = useAuth();

  const load = useCallback(async () => {
    try {
      setShift(await api.get<ShiftView>('/driver/shift'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    document.body.classList.add('theme-driver');
    document.documentElement.classList.add('theme-driver');
    void load();
    return () => {
      document.body.classList.remove('theme-driver');
      document.documentElement.classList.remove('theme-driver');
    };
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });

  const act = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      try {
        await fn();
        if (ok) toast.show(ok);
      } catch (e) {
        toast.show(e instanceof ApiError ? e.message : 'Не получилось, повторите');
      } finally {
        void load();
      }
    },
    [load, toast],
  );

  const unread = useUnread();
  const current = useMemo(() => shift?.stops.find((s) => !s.doneAt && s.rides.some((r) => r.status !== 'cancelled')), [shift]);

  return (
    <div className="app theme-driver">
      <main className="page" style={{ paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
        <RoleSwitch />
        <div className="page-head">
          <h1 className="page-title">Смена</h1>
          <span className="page-sub">{shift?.dayLabel}</span>
        </div>
        <div className="btn-row">
          {me?.roles.includes('dispatcher') && (
            <Link to="/admin" className="btn small secondary">
              ‹ Диспетчерская
            </Link>
          )}
          <button
            className="btn small secondary"
            onClick={async () => {
              await api.post('/auth/logout');
              setMe(null);
            }}
          >
            Выйти
          </button>
        </div>
        <Link to="/driver/chat" className="btn secondary block">
          Сообщения
          <Badge n={unread} />
        </Link>
        {error && <div className="note error">{error}</div>}
        {shift?.run && (
          <div className="page-sub">
            {[shift.run.vehicle, shift.run.plate, `${shift.stops.length} ${plural(shift.stops.length, ['точка', 'точки', 'точек'])}`, me?.name].filter(Boolean).join(' · ')}
          </div>
        )}
        {!me?.lite && <Tracking shift={shift} />}
        <PushCard compact />
        {!shift ? (
          <div className="empty">Загрузка…</div>
        ) : !shift.run ? (
          <div className="card empty">Сегодня смены нет</div>
        ) : (
          shift.stops.map((s) => <StopCard key={s.id} stop={s} current={s.id === current?.id} act={act} />)
        )}
        {shift?.run && !current && shift.stops.length > 0 && <div className="note plain">Все точки пройдены. Смена завершена.</div>}
      </main>
      {toast.node}
    </div>
  );
}

function StopCard({ stop, current, act }: { stop: StopView; current: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const lite = !!useAuth().me?.lite;
  const live = stop.rides.filter((r) => r.status !== 'cancelled');
  const pickup = stop.kind === 'pickup';
  const waiting = live.filter((r) => ['planned', 'confirmed', 'driver_en_route', 'driver_arrived', 'no_show'].includes(r.status));
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => setChosen(waiting.filter((r) => r.status !== 'no_show').map((r) => r.id)), [stop.id, waiting.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = !!stop.doneAt || !live.length;
  const kidsNames = (ids: string[]) => live.filter((r) => ids.includes(r.id)).map((r) => r.child.firstName).join(', ');
  const phones = [...new Set(live.map((r) => r.parentPhone).filter(Boolean))] as string[];

  return (
    <section className={`stop${current ? ' current' : ''}${done ? ' done' : ''}`}>
      <div className="stop-head">
        <b>
          {pickup ? 'Забрать' : 'Высадить'} · {stop.place.name}
        </b>
        <time>{stop.doneAt ?? stop.eta ?? stop.plannedAt}</time>
      </div>
      {!current && (
        <div className="page-sub" style={{ fontSize: 14 }}>
          {stop.rides.map((r) => (
            <span key={r.id} style={{ textDecoration: r.status === 'cancelled' ? 'line-through' : undefined, marginRight: 8 }}>
              {r.child.firstName}
            </span>
          ))}
          {done && stop.doneAt ? '· готово' : ''}
        </div>
      )}
      {current && (
        <>
          <small>
            {stop.place.address}
            {stop.place.entranceNote ? ` · ${stop.place.entranceNote}` : ''}
          </small>
          {live.map((r) => (
            <div key={r.id} className="kid-line">
              {pickup && ['driver_arrived', 'no_show', 'driver_en_route', 'planned', 'confirmed'].includes(r.status) && stop.arrivedAt ? (
                <button
                  className={`check${chosen.includes(r.id) ? ' on' : ''}`}
                  aria-label={`Выбрать ${r.child.firstName}`}
                  onClick={() => setChosen((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id]))}
                >
                  {chosen.includes(r.id) ? '✓' : ''}
                </button>
              ) : null}
              <Avatar child={r.child} size={36} />
              <span className="grow">
                <b>
                  {r.child.firstName}
                  {r.child.grade ? `, ${r.child.grade}` : ''}
                  {SEAT[r.child.seat] ? ` · ${SEAT[r.child.seat]}` : ''}
                </b>
                <small>
                  {pickup ? `→ ${r.to.name}` : `из «${r.from.name}»`}
                  {r.child.notes ? ` · ${r.child.notes}` : ''}
                </small>
              </span>
              <Tag tone={r.tone}>{r.statusLabel}</Tag>
            </div>
          ))}

          {!lite && (
            <div className="btn-row">
              <a className="btn small secondary" href={routeHref(stop.place.lat, stop.place.lon)} target="_blank" rel="noreferrer">
                Маршрут
              </a>
              {phones[0] && (
                <a className="btn small secondary" href={phoneHref(phones[0])}>
                  Позвонить родителю
                </a>
              )}
            </div>
          )}

          {pickup && !stop.departedAt && !stop.arrivedAt && (
            <button
              className="btn gold block"
              onClick={() => {
                if (!lite) startTracking();
                void act(() => api.post(`/driver/stops/${stop.id}/depart`), 'Семьи получили «водитель выехал»');
              }}
            >
              Еду сюда
            </button>
          )}
          {pickup && stop.departedAt && !stop.arrivedAt && (
            <button className="btn block" onClick={() => act(() => api.post(`/driver/stops/${stop.id}/arrive`), 'Отметил: на месте')}>
              Я на месте
            </button>
          )}

          {pickup && stop.arrivedAt && waiting.length > 0 && (
            <>
              <SwipeButton
                label={chosen.length ? `Посадил: ${kidsNames(chosen)}` : 'Выберите детей'}
                disabled={!chosen.length}
                onConfirm={() => act(() => api.post(`/driver/stops/${stop.id}/board`, { rideIds: chosen }), 'Родители получили «в машине»')}
              />
              {waiting
                .filter((r) => r.status === 'driver_arrived')
                .map((r) => (
                  <button key={r.id} className="btn small danger" onClick={() => act(() => api.post(`/driver/rides/${r.id}/no-show`), 'Родителю отправлено: не вышел')}>
                    {r.child.firstName} не выходит
                  </button>
                ))}
            </>
          )}

          {!pickup && live.filter((r) => r.status === 'on_board').map((r) => <Handover key={r.id} rideId={r.id} name={r.child.firstName} options={r.child.handoverTo} act={act} />)}
        </>
      )}
    </section>
  );
}

function Handover({ rideId, name, options, act }: { rideId: string; name: string; options: string[]; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const list = [...new Set([...options, 'педагог', 'администратор', 'родитель'])];
  const [receiver, setReceiver] = useState(list[0]);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="pick" role="radiogroup" aria-label={`Кому передан ${name}`}>
        {list.map((x) => (
          <button key={x} className={receiver === x ? 'on' : ''} onClick={() => setReceiver(x)} role="radio" aria-checked={receiver === x}>
            {x}
          </button>
        ))}
      </div>
      <SwipeButton label={`Передал: ${name} → ${receiver}`} onConfirm={() => act(() => api.post(`/driver/rides/${rideId}/handover`, { receiver }), 'Родители получили «на месте»')} />
    </div>
  );
}

/** Координаты: из открытого приложения и из фонового трекера Traccar Client. */
const TRACK_KEY = 'nm_tracking_on';
const readTrackOn = () => {
  try {
    return localStorage.getItem(TRACK_KEY) === '1';
  } catch {
    return false;
  }
};
/** Включить передачу координат: вызывается при «Еду сюда» — водителю не нужно помнить про отдельную кнопку. */
export function startTracking() {
  window.dispatchEvent(new Event('nm:track-on'));
}

function Tracking({ shift }: { shift: ShiftView | null }) {
  const [on, setOnState] = useState(readTrackOn);
  const setOn = (v: boolean) => {
    setOnState(v);
    try {
      localStorage.setItem(TRACK_KEY, v ? '1' : '0');
    } catch {
      // без памяти браузера просто не запомним выбор
    }
  };
  useEffect(() => {
    const onStart = () => setOn(true);
    window.addEventListener('nm:track-on', onStart);
    return () => window.removeEventListener('nm:track-on', onStart);
  }, []);
  const [status, setStatus] = useState<string>('');
  const [open, setOpen] = useState(false);
  const watch = useRef<number | null>(null);
  const lastSent = useRef(0);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!on) return;
    if (!('geolocation' in navigator)) {
      setStatus('Геолокация недоступна в этом браузере');
      return;
    }
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastSent.current < 8000) return;
        lastSent.current = Date.now();
        void api
          .post('/driver/position', { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading })
          .then(() => setStatus(`Отправлено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`))
          .catch(() => setStatus('Нет связи, повторю'));
      },
      (e) => setStatus(e.code === 1 ? 'Разрешите доступ к геопозиции в настройках' : 'Не удаётся определить место'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    // экран не гаснет, пока смена открыта
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wl?.request('screen').then((l) => (lock.current = l)).catch(() => {});
    return () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      void lock.current?.release().catch(() => {});
    };
  }, [on]);

  return (
    <div className="note plain">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>
          <b>Координаты</b>
          <br />
          <small className="page-sub">{on ? status || 'Определяю…' : 'Родители видят машину на карте'}</small>
        </span>
        <button className={`btn small ${on ? 'secondary' : 'gold'}`} onClick={() => setOn(!on)}>
          {on ? 'Выключить' : 'Включить'}
        </button>
      </div>
      {shift?.trackerHint && (
        <>
          <button className="btn small secondary" onClick={() => setOpen(!open)}>
            {open ? 'Скрыть' : 'Фоновый трекер для iPhone'}
          </button>
          {open && (
            <small style={{ display: 'grid', gap: 6 }}>
              <span>Веб-приложение передаёт координаты, только пока открыто. Чтобы машина была видна с погасшим экраном и в навигаторе, поставьте бесплатное приложение Traccar Client из App Store и введите:</span>
              <span>
                Адрес сервера: <b style={{ userSelect: 'all' }}>{shift.trackerHint.url}</b>
              </span>
              <span>
                Идентификатор: <b style={{ userSelect: 'all' }}>{shift.trackerHint.deviceId}</b>
              </span>
              <span>Точность: высокая, интервал: 10 секунд. Включайте в начале смены.</span>
            </small>
          )}
        </>
      )}
    </div>
  );
}
