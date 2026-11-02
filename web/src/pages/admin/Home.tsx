// Главная диспетчера на телефоне: что ждёт решения и что происходит сегодня — плитками.
// На компьютере диспетчер работает в большой диспетчерской (/admin), сюда ведёт плашка роли с телефона.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { useUnread } from '../../components/Chat';
import { Tile, IconCar, IconChat, IconClock, IconInbox, IconRoute, IconUsers } from '../../components/Tiles';
import type { ChangeRow, RequestRow } from '../parent/Requests';
import type { AdminDay } from '@shared/api';
import { localDate } from '@shared/time';
import { plural } from '@shared/ru';
import { Clock } from '../../components/Clock';

export function DispatcherHome() {
  const { me } = useAuth();
  const unread = useUnread();
  const [data, setData] = useState<{
    day: AdminDay;
    changes: ChangeRow[];
    requests: RequestRow[];
  } | null>(null);

  const load = useCallback(async () => {
    const [day, changes, requests] = await Promise.all([api.get<AdminDay>(`/admin/day?date=${localDate()}`), api.get<ChangeRow[]>('/admin/changes'), api.get<RequestRow[]>('/admin/requests')]);
    setData({ day, changes, requests });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });

  if (!data)
    return (
      <main className="page">
        <div className="empty">Загрузка…</div>
      </main>
    );
  const { day, changes, requests } = data;
  const waiting = changes.filter((c) => c.status === 'new');
  const newRequests = requests.filter((r) => r.status === 'new');
  const active = day.runs.filter((r) => r.status === 'active').length;
  const runsText = day.runs.length
    ? `${day.runs.length} ${plural(day.runs.length, ['рейс', 'рейса', 'рейсов'])} · ${day.stats.children} ${plural(day.stats.children, ['ребёнок', 'ребёнка', 'детей'])}${active ? ` · ${active} в пути` : ''} · ${day.runs.map((r) => r.driverName).join(', ')}`
    : 'Сегодня рейсов нет';

  return (
    <div className="app">
      <main className="page">
        <div className="page-head">
          <Clock />
          <h1 className="page-title">Диспетчерская</h1>
        </div>
        <nav className="tiles" aria-label="Разделы">
          <Tile
            to="/admin/inbox"
            title="Просьбы родителей"
            sub={waiting.length ? `${waiting.length} ${plural(waiting.length, ['ждёт', 'ждут', 'ждут'])} решения · ${waiting[0].childName}: ${waiting[0].summary}` : 'Новых просьб нет'}
            accent={waiting.length > 0}
            icon={<IconClock />}
          />
          <Tile
            to="/admin/inbox"
            title="Заявки на поездки"
            sub={
              newRequests.length
                ? `${newRequests.length} ${plural(newRequests.length, ['новая', 'новые', 'новых'])} · ${newRequests[0].children.join(', ')} ${newRequests[0].time}`
                : 'Новых заявок нет'
            }
            accent={newRequests.length > 0}
            icon={<IconInbox />}
          />
          <Tile to="/admin" title="Рейсы сегодня" sub={runsText} accent={active > 0} icon={<IconRoute />} />
          <Tile to="/admin/clients" title="Клиенты" sub="Семьи, места, поездки по расписанию, водители и коды входа" icon={<IconUsers />} />
          <Tile to="/admin/chat" title="Сообщения" sub={unread ? `${unread} ${plural(unread, ['новое', 'новых', 'новых'])}` : 'Семьи и водители'} accent={unread > 0} icon={<IconChat />} />
          {me?.roles.includes('driver') && <Tile to="/driver" title="Моя смена" sub="Вы тоже водитель — ваш рейс и неделя" icon={<IconCar />} />}
        </nav>
      </main>
    </div>
  );
}
