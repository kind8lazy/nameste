// Диспетчерская на компьютере: день по машинам, живая карта, семьи и коды входа, журнал уведомлений.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { Avatar, Sheet, Tag, useToast } from '../../components/ui';
import { MiniMap } from '../../components/MiniMap';
import { Badge, useUnread } from '../../components/Chat';
import { DemoCard } from '../../components/DemoCard';
import { REQUEST_STATUS, CHANGE_STATUS, type RequestRow, type ChangeRow } from '../parent/Requests';
import type { AdminDay, Position, RideView } from '@shared/api';
import { addDays, localDate } from '@shared/time';

interface FamilyRow {
  id: string;
  name: string;
  members: { userId: string; name: string; relation: string; phone: string | null; push: boolean; isOwner: boolean }[];
  children: { id: string; firstName: string; grade: string | null }[];
  templates: { id: string; time: string; ruleText: string; priceRub: number }[];
}

interface NotificationRow {
  id: string;
  userName?: string;
  title: string;
  status: string;
  channel: string;
  createdAt: string;
}

export function Board() {
  const { me, setMe } = useAuth();
  const lite = !!me?.lite;
  const unread = useUnread();
  const [date, setDate] = useState(localDate());
  const [day, setDay] = useState<AdminDay | null>(null);
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [log, setLog] = useState<NotificationRow[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [cancelRide, setCancelRide] = useState<RideView | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const [d, f, n] = await Promise.all([
      api.get<AdminDay>(`/admin/day?date=${date}`),
      api.get<FamilyRow[]>('/admin/families'),
      api.get<NotificationRow[]>('/admin/notifications'),
    ]);
    setDay(d);
    setFamilies(f);
    setLog(n);
    setRequests(await api.get<RequestRow[]>('/admin/requests'));
    setChanges(await api.get<ChangeRow[]>('/admin/changes'));
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
      <nav className="desk-nav">
        <div className="wordmark">
          НА<i />МЕСТЕ
        </div>
        <a className="active" href="#day">
          Диспетчерская
        </a>
        <a href="/admin/clients">Клиенты: семьи, места, поездки</a>
        <a href="/admin/chat">
          Сообщения
          <Badge n={unread} />
        </a>
        <a href="#changes">Просьбы родителей</a>
        <a href="#requests">Заявки</a>
        <a href="#families">Семьи и коды входа</a>
        <a href="#log">Уведомления</a>
        <a href="/driver">Моя смена (водитель)</a>
        <a
          href="#"
          onClick={async (e) => {
            e.preventDefault();
            await api.post('/auth/logout');
            setMe(null);
          }}
        >
          Выйти ({me?.name})
        </a>
        <a
          href="#"
          onClick={async (e) => {
            e.preventDefault();
            await api.post('/auth/logout-all');
            setMe(null);
          }}
        >
          Выйти на всех устройствах
        </a>
      </nav>

      <main className="desk-main" id="day">
        <div className="page-head">
          <h1 className="page-title">{day?.dayLabel ?? '…'}</h1>
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
              className="btn small"
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
              Пересобрать рейс
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
              <Tag tone={r.status === 'active' ? 'gold' : r.status === 'done' ? 'ok' : 'plan'}>{r.status === 'active' ? 'в пути' : r.status === 'done' ? 'завершён' : 'в плане'}</Tag>
            </h3>
            <table className="table">
              <thead>
                <tr>
                  <th>План</th>
                  <th>Факт / прогноз</th>
                  <th>Точка</th>
                  <th>Дети</th>
                </tr>
              </thead>
              <tbody>
                {r.stops.map((s) => (
                  <tr key={s.id} style={{ opacity: s.doneAt ? 0.6 : 1, background: s.id === next?.id ? '#f3ead8' : undefined }}>
                    <td className="mono">{s.plannedAt}</td>
                    <td className="mono">{s.doneAt ? `✓ ${s.doneAt}` : s.arrivedAt ? `на месте ${s.arrivedAt}` : s.eta ? `≈ ${s.eta}` : '—'}</td>
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
                              <Tag tone={x.tone}>{x.statusLabel}</Tag>
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
        <h3 id="changes">Просьбы родителей {changes.filter((c) => c.status === 'new').length ? `(${changes.filter((c) => c.status === 'new').length})` : ''}</h3>
        {!changes.some((c) => c.status === 'new') && <div className="page-sub">Новых просьб нет</div>}
        {changes
          .filter((c) => c.status === 'new')
          .concat(changes.filter((c) => c.status !== 'new' && c.status !== 'withdrawn').slice(0, 3))
          .map((c) => (
            <ChangeCard key={c.id} c={c} onDone={(m) => { toast.show(m); void load(); }} />
          ))}
        <h3 id="requests">Заявки {requests.filter((r) => r.status === 'new').length ? `(${requests.filter((r) => r.status === 'new').length})` : ''}</h3>
        {!requests.length && <div className="page-sub">Пока заявок нет</div>}
        {requests.slice(0, 8).map((r) => (
          <div key={r.id} className="card" style={{ padding: 12, display: 'grid', gap: 6, boxShadow: r.status === 'new' ? 'inset 3px 0 0 #B8964F' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>
                {r.time} {r.children.join(', ')}
              </b>
              <span className={`tag tone-${REQUEST_STATUS[r.status][0]}`}>{REQUEST_STATUS[r.status][1]}</span>
            </div>
            <small className="page-sub">
              {r.familyName} · {r.from} → {r.to} · {r.ruleText}{lite ? '' : ` · ${r.priceRub.toLocaleString('ru-RU')} ₽`}
            </small>
            {r.comment && <small>«{r.comment}»</small>}
            {r.status === 'new' && (
              <div className="btn-row">
                <button
                  className="btn small"
                  onClick={async () => {
                    try {
                      await api.post(`/admin/requests/${r.id}/accept`);
                      toast.show('Принято: поездки добавлены в неделю семьи');
                    } catch (e) {
                      toast.show(e instanceof ApiError ? e.message : 'Не получилось');
                    }
                    void load();
                  }}
                >
                  Принять
                </button>
                <button
                  className="btn small secondary"
                  onClick={async () => {
                    await api.post(`/admin/requests/${r.id}/decline`, { answer: 'На это время машина занята. Напишем, как появится окно.' });
                    toast.show('Семья получила ответ');
                    void load();
                  }}
                >
                  Нет окна
                </button>
              </div>
            )}
          </div>
        ))}
        <h3 id="families">Семьи</h3>
        {families.map((f) => (
          <div key={f.id} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <b>{f.name}</b>
            <small className="page-sub">
              Дети: {f.children.map((c) => c.firstName).join(', ') || '—'} · шаблонов: {f.templates.length}
            </small>
            {f.members.map((m) => (
              <div key={m.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>
                  {m.name} <small className="page-sub">({m.relation}{m.push ? ', уведомления вкл.' : ''})</small>
                </span>
                {codes[m.userId] ? (
                  <b className="mono" style={{ userSelect: 'all', letterSpacing: '0.1em' }}>
                    {codes[m.userId]}
                  </b>
                ) : (
                  <button
                    className="btn small secondary"
                    onClick={async () => {
                      const r = await api.post<{ code: string }>(`/admin/users/${m.userId}/invite`);
                      setCodes((c) => ({ ...c, [m.userId]: r.code }));
                    }}
                  >
                    Код входа
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        <h3 id="log">Уведомления</h3>
        <div className="card" style={{ padding: 0, maxHeight: 360, overflow: 'auto' }}>
          <table className="table" style={{ border: 0 }}>
            <tbody>
              {log.slice(0, 30).map((n) => (
                <tr key={n.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(n.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>
                    {n.title}
                    <br />
                    <small className="page-sub">
                      {n.userName} · {n.channel === 'email' ? 'письмо' : n.channel === 'sms' ? 'SMS' : 'в приложении'} · {n.status === 'sent' ? 'отправлено' : n.status === 'no_device' ? 'приложение не установлено' : 'ошибка'}
                    </small>
                  </td>
                </tr>
              ))}
              {!log.length && (
                <tr>
                  <td className="page-sub">Пока пусто</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </aside>
      <CancelRideSheet ride={cancelRide} onClose={() => setCancelRide(null)} onDone={(m) => { toast.show(m); void load(); }} />
      {toast.node}
    </div>
  );
}

/** Просьба родителя: принять как есть, принять со своим временем или отказать с причиной. */
function ChangeCard({ c, onDone }: { c: ChangeRow; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<'time' | 'decline' | null>(null);
  const [time, setTime] = useState(c.time ?? '');
  const [answer, setAnswer] = useState('В это время водитель занят.');
  const call = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      onDone(ok);
    } catch (e) {
      onDone(e instanceof ApiError ? e.message : 'Не получилось');
    }
  };
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 6, boxShadow: c.status === 'new' ? 'inset 3px 0 0 #B8964F' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>{c.title[0].toUpperCase() + c.title.slice(1)}</b>
        <span className={`tag tone-${CHANGE_STATUS[c.status][0]}`}>{CHANGE_STATUS[c.status][1]}</span>
      </div>
      <small className="page-sub">
        {c.familyName} · {c.summary}
        {c.reason ? ` · ${c.reason}` : ''}
      </small>
      {c.answer && <small>Ответ: {c.answer}</small>}
      {c.status === 'new' && !mode && (
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => void call(() => api.post(`/admin/changes/${c.id}/accept`), 'Принято, рейс пересобран, семья получила ответ')}>
            Принять
          </button>
          {c.kind === 'time' && (
            <button className="btn small secondary" onClick={() => setMode('time')}>
              Другое время
            </button>
          )}
          <button className="btn small secondary" onClick={() => setMode('decline')}>
            Отказать
          </button>
        </div>
      )}
      {mode === 'time' && (
        <div className="btn-row" style={{ alignItems: 'end' }}>
          <div className="field">
            <label htmlFor={`ct-${c.id}`}>Могу забрать в</label>
            <input id={`ct-${c.id}`} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <button className="btn small" disabled={!time} onClick={() => void call(() => api.post(`/admin/changes/${c.id}/accept`, { time }), `Принято на ${time}, семья получила ответ`)}>
            Принять на {time || '…'}
          </button>
          <button className="btn small secondary" onClick={() => setMode(null)}>
            Назад
          </button>
        </div>
      )}
      {mode === 'decline' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input className="input" aria-label="Причина отказа" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="btn-row">
            <button className="btn small" disabled={answer.trim().length < 3} onClick={() => void call(() => api.post(`/admin/changes/${c.id}/decline`, { answer }), 'Семья получила ответ')}>
              Отправить отказ
            </button>
            <button className="btn small secondary" onClick={() => setMode(null)}>
              Назад
            </button>
          </div>
        </div>
      )}
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
