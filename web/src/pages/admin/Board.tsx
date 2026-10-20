// Диспетчерская на компьютере: день по машинам, живая карта, семьи и коды входа, журнал уведомлений.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { Avatar, Tag, useToast } from '../../components/ui';
import { MiniMap } from '../../components/MiniMap';
import { Badge, useUnread } from '../../components/Chat';
import { DemoCard } from '../../components/DemoCard';
import { REQUEST_STATUS, type RequestRow } from '../parent/Requests';
import type { AdminDay, Position } from '@shared/api';
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
              {r.vehicle} · {r.plate} · {r.driverName}{' '}
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
                        {s.rides.map((x) => (
                          <span key={x.id} className="kid-chip" style={{ fontSize: 13, opacity: x.status === 'cancelled' ? 0.5 : 1 }}>
                            <Avatar child={x.child} size={20} />
                            {x.child.firstName}
                            <Tag tone={x.tone}>{x.statusLabel}</Tag>
                          </span>
                        ))}
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
      {toast.node}
    </div>
  );
}
