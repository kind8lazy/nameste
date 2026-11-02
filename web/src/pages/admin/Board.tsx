// «Сегодня» на компьютере: рейсы дня по водителям и то, что ждёт решения диспетчера.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { Avatar, Sheet, Tag, useToast } from '../../components/ui';
import { MiniMap } from '../../components/MiniMap';
import { DemoCard } from '../../components/DemoCard';
import { PendingList, useInbox } from './Inbox';
import { DeskNav } from './DeskNav';
import type { AdminDay, Position, RideView } from '@shared/api';
import { addDays, localDate } from '@shared/time';
import { Clock } from '../../components/Clock';

export function Board() {
  const { me } = useAuth();
  const lite = !!me?.lite;
  const [date, setDate] = useState(localDate());
  const [day, setDay] = useState<AdminDay | null>(null);
  const [cancelRide, setCancelRide] = useState<RideView | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setDay(await api.get<AdminDay>(`/admin/day?date=${date}`));
  }, [date]);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({
    rides: () => void load(),
    refresh: () => void load(),
    position: (p) => {
      const pos = p as Position & { driverId: string };
      setDay((d) => (d ? { ...d, positions: { ...d.positions, [pos.driverId]: pos } } : d));
    },
  });

  const run = day?.runs[0];
  const next = run?.stops.find((s) => !s.doneAt);
  const car = Object.values(day?.positions ?? {})[0] ?? null;

  return (
    <div className="desk">
      <DeskNav />

      <main className="desk-main" id="day">
        <div className="page-head">
          <Clock />
          <h1 className="page-title">{date === localDate() ? 'Сегодня' : (day?.dayLabel ?? '…')}</h1>
          <div className="btn-row" style={{ flex: 'none' }}>
            <button className="btn small secondary" onClick={() => setDate(addDays(date, -1))}>
              ‹
            </button>
            <button className="btn small secondary" onClick={() => setDate(localDate())}>
              Сегодня
            </button>
            <button className="btn small secondary" onClick={() => setDate(addDays(date, 1))}>
              ›
            </button>
            <button
              className="btn small secondary"
              title="Рейс пересобирается сам при любом изменении. Нажмите, чтобы проверить, успевает ли водитель по времени."
              onClick={async () => {
                try {
                  const r = await api.post<{ late: { plannedAt: string; lateMin: number }[] }>(`/admin/days/${date}/plan`);
                  toast.show(r.late.length ? `Рейс пересобран. Не успеваем: ${r.late.map((l) => `${l.plannedAt} (+${l.lateMin} мин)`).join(', ')}` : 'Рейс пересобран, по времени успеваем');
                } catch (e) {
                  toast.show(e instanceof ApiError ? e.message : 'Не получилось');
                }
                void load();
              }}
            >
              Проверить время
            </button>
          </div>
        </div>

        {day && (
          <div className="kpis">
            <span className="kpi">
              поездок<b>{day.stats.rides}</b>
            </span>
            <span className="kpi">
              детей<b>{day.stats.children}</b>
            </span>
            {!lite && (
              <>
                <span className="kpi">
                  выручка<b>{day.stats.revenueRub.toLocaleString('ru-RU')} ₽</b>
                </span>
                <span className="kpi">
                  оплачиваемые км<b>≈ {day.stats.paidKm}</b>
                </span>
                <span className="kpi">
                  пустые км<b>≈ {day.stats.emptyKm}</b>
                </span>
              </>
            )}
          </div>
        )}

        {!lite && <MiniMap car={car} target={next ? { lat: next.place.lat, lon: next.place.lon, name: next.place.name } : null} height={260} />}

        {day?.runs.map((r) => (
          <section key={r.id} style={{ display: 'grid', gap: 8 }}>
            <h3>
              {[r.driverName, r.vehicle, r.plate].filter(Boolean).join(' · ')}{' '}
              {r.status !== 'planned' && <Tag tone={r.status === 'active' ? 'gold' : 'ok'}>{r.status === 'active' ? 'в пути' : 'завершён'}</Tag>}
            </h3>
            <table className="table">
              <thead>
                <tr>
                  <th>План</th>
                  {r.status !== 'planned' && <th>Факт / прогноз</th>}
                  <th>Точка</th>
                  <th>Дети</th>
                </tr>
              </thead>
              <tbody>
                {r.stops.map((s) => (
                  <tr key={s.id} style={{ opacity: s.doneAt ? 0.6 : 1, background: s.id === next?.id ? '#f3ead8' : undefined }}>
                    <td className="mono">{s.plannedAt}</td>
                    {r.status !== 'planned' && <td className="mono">{s.doneAt ? `✓ ${s.doneAt}` : s.arrivedAt ? `на месте ${s.arrivedAt}` : s.eta ? `≈ ${s.eta}` : '—'}</td>}
                    <td>
                      <b>{s.kind === 'pickup' ? 'Забрать' : 'Высадить'}</b> · {s.place.name}
                    </td>
                    <td>
                      <div className="kids">
                        {s.rides.map((x) => {
                          const chip = (
                            <>
                              <Avatar child={x.child} size={20} />
                              {x.child.firstName}
                              {x.status !== 'planned' && <Tag tone={x.tone}>{x.statusLabel}</Tag>}
                            </>
                          );
                          // отменить можно, пока ребёнок не в машине; нажимаем на ребёнка в точке забора
                          return s.kind === 'pickup' && CANCELLABLE.includes(x.status) ? (
                            <button key={x.id} type="button" className="kid-chip" title="Отменить поездку" style={{ fontSize: 13, cursor: 'pointer', font: 'inherit' }} onClick={() => setCancelRide(x)}>
                              {chip}
                            </button>
                          ) : (
                            <span key={x.id} className="kid-chip" style={{ fontSize: 13, opacity: x.status === 'cancelled' ? 0.5 : 1 }}>
                              {chip}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {day && !day.runs.length && <div className="card empty">На этот день рейса нет</div>}
        {day && day.unassigned.length > 0 && (
          <div className="note">
            <b>Без машины: {day.unassigned.length}</b>
            {day.unassigned.map((r) => (
              <span key={r.id}>
                {r.pickupTime} {r.child.firstName}: {r.from.name} → {r.to.name}
              </span>
            ))}
          </div>
        )}
      </main>

      <aside className="desk-side">
        {!lite && <DemoCard />}
        <h3>Ждут решения</h3>
        <PendingList onDone={(m) => { toast.show(m); void load(); }} />
        <PendingEmpty />
      </aside>
      <CancelRideSheet ride={cancelRide} onClose={() => setCancelRide(null)} onDone={(m) => { toast.show(m); void load(); }} />
      {toast.node}
    </div>
  );
}

const CANCELLABLE = ['planned', 'confirmed', 'driver_en_route', 'driver_arrived'];
const CANCEL_REASONS = ['Заболел', 'Заберут сами', 'Занятие отменили', 'Нет свободного водителя'];

/** Отмена одной поездки диспетчером: расписание не меняется, семья получает уведомление. */
function CancelRideSheet({ ride, onClose, onDone }: { ride: RideView | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ride) return null;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/rides/${ride.id}/cancel`, { reason });
      onDone(`Поездка ${ride.child.firstName} отменена, семья получила уведомление`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose}>
      <h3>
        Отменить поездку {ride.child.firstName}?
      </h3>
      <div className="page-sub">
        {ride.pickupTime} · {ride.from.name} → {ride.to.name}. Только на этот день — расписание не меняется.
      </div>
      <div className="field">
        <label>Причина (увидит семья)</label>
        <div className="pick">
          {CANCEL_REASONS.map((x) => (
            <button key={x} type="button" className={reason === x ? 'on' : ''} onClick={() => setReason(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="note error">{error}</div>}
      <button className="btn danger block" disabled={busy} onClick={() => void send()}>
        Отменить поездку
      </button>
      <button className="btn secondary block" onClick={onClose}>
        Не отменять
      </button>
    </Sheet>
  );
}

function PendingEmpty() {
  const { requests, changes } = useInbox();
  if (changes.some((c) => c.status === 'new') || requests.some((r) => r.status === 'new')) return null;
  return <div className="page-sub">Новых просьб и заявок нет</div>;
}
