// Неделя: шаблон повторяется сам, исключения видны сразу, завтра подтверждается одной кнопкой.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useStream } from '../../lib/stream';
import { groupTrips, tripState } from '../../lib/trips';
import { Tag, useToast } from '../../components/ui';
import { RideSheet } from './RideSheet';
import { MyRequests } from './Requests';
import { Link } from 'react-router-dom';
import type { RideView, WeekDay } from '@shared/api';
import { addDays, formatDateRu, localDate, WEEKDAYS_SHORT, weekStart } from '@shared/time';
import { plural, TRIPS } from '@shared/ru';

export function Week() {
  const { me } = useAuth();
  const canOrder = !!me?.families.some((f) => f.canEdit) || !!me?.roles.includes('dispatcher');
  const [params, setParams] = useSearchParams();
  const today = localDate();
  const [selected, setSelected] = useState(params.get('date') ?? today);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [sheet, setSheet] = useState<RideView[] | null>(null);
  const toast = useToast();
  const monday = weekStart(selected);

  const load = useCallback(async () => {
    setWeek(await api.get<WeekDay[]>(`/parent/week?date=${monday}`));
  }, [monday]);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });

  const day = week?.find((d) => d.date === selected);
  const trips = useMemo(() => groupTrips(day?.rides ?? []), [day]);
  const tomorrow = addDays(today, 1);
  const tomorrowPlanned = week?.find((d) => d.date === tomorrow)?.rides.filter((r) => r.status === 'planned') ?? [];
  const active = week?.flatMap((d) => d.rides).filter((r) => r.status !== 'cancelled') ?? [];
  const total = active.reduce((s, r) => s + r.priceRub, 0);

  const go = (date: string) => {
    setSelected(date);
    setParams({ date }, { replace: true });
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">Неделя</h1>
        <span className="page-sub">
          {formatDateRu(monday)} – {formatDateRu(addDays(monday, 6))}
        </span>
      </div>
      <div className="btn-row">
        <button className="btn small secondary" onClick={() => go(addDays(monday, -7))}>
          ‹ Назад
        </button>
        <button className="btn small secondary" onClick={() => go(today)}>
          Сегодня
        </button>
        <button className="btn small secondary" onClick={() => go(addDays(monday, 7))}>
          Вперёд ›
        </button>
      </div>
      <div className="week-strip" role="tablist">
        {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d, i) => {
          const n = groupTrips((week?.find((w) => w.date === d)?.rides ?? []).filter((r) => r.status !== 'cancelled')).length;
          return (
            <button key={d} role="tab" aria-selected={d === selected} className={`${d === selected ? 'on' : ''}${d === today ? ' today' : ''}`} onClick={() => go(d)}>
              {WEEKDAYS_SHORT[i]}
              <b>{Number(d.slice(8))}</b>
              <em>{'●'.repeat(Math.min(n, 4))}</em>
            </button>
          );
        })}
      </div>

      {canOrder && tomorrowPlanned.length > 0 && (
        <div className="note">
          <b>
            Завтра {groupTrips(tomorrowPlanned).length} {plural(groupTrips(tomorrowPlanned).length, TRIPS)}. Всё в силе?
          </b>
          <div className="btn-row">
            <button
              className="btn small"
              onClick={async () => {
                await api.post(`/parent/days/${tomorrow}/confirm`);
                toast.show('Завтра подтверждено');
                void load();
              }}
            >
              Да, всё в силе
            </button>
            <button className="btn small secondary" onClick={() => go(tomorrow)}>
              Изменить
            </button>
          </div>
        </div>
      )}

      {!week ? (
        <div className="empty">Загрузка…</div>
      ) : trips.length === 0 ? (
        <div className="card empty">В этот день поездок нет</div>
      ) : (
        <ul className="list">
          {trips.map((t) => {
            const s = tripState(t);
            return (
              <li key={t.key}>
                <button className={`row${s.cancelled ? ' cancelled' : ''}`} onClick={() => setSheet(t.rides)}>
                  <time>{t.pickupTime}</time>
                  <span className="main">
                    <b>{t.rides.filter((r) => r.status !== 'cancelled' || s.cancelled).map((r) => r.child.firstName).join(', ')}</b>
                    <small>
                      {t.fromName} → {[...new Set(t.rides.map((r) => r.to.name))].join(', ')}
                      {t.rides.some((r) => r.status === 'cancelled') && !s.cancelled ? ` · отмена: ${t.rides.filter((r) => r.status === 'cancelled').map((r) => r.child.firstName).join(', ')}` : ''}
                    </small>
                  </span>
                  <Tag tone={s.cancelled ? 'muted' : t.rides.every((r) => r.status === 'confirmed') ? 'ok' : s.tone}>
                    {s.cancelled ? 'отменена' : s.done ? 'на месте' : t.rides.every((r) => r.status === 'confirmed') ? 'подтв.' : s.live ? 'сейчас' : 'план'}
                  </Tag>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canOrder && (
        <Link to="/app/new" className="btn gold block">
          + Новая поездка или маршрут
        </Link>
      )}
      {params.get('sent') && <div className="note">Заявка отправлена. Диспетчер ответит, уведомление придёт на телефон.</div>}
      <MyRequests />
      <div className="card" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between' }}>
        <span>
          За неделю: {active.length} {plural(active.length, TRIPS)}
        </span>
        {!me?.lite && <b className="mono">{total.toLocaleString('ru-RU')} ₽</b>}
      </div>
      <RideSheet rides={sheet} onClose={() => setSheet(null)} onDone={(m) => { toast.show(m); void load(); }} />
      {toast.node}
    </main>
  );
}
