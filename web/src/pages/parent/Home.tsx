// Главная родителя: короткий список разделов, у каждого — живая подпись (что сейчас и что дальше).
// Подробности — внутри раздела: «Сегодня» с картой и шагами, «Неделя», чат, просьбы диспетчеру.
import { useCallback, useEffect, useState } from 'react';
import { Tile, IconCar, IconCalendar, IconPause, IconPlus, IconClock, IconChat } from '../../components/Tiles';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/ui';
import { useUnread } from '../../components/Chat';
import { AbsenceSheet, type ChangeRow } from './Requests';
import { Today } from './Today';
import type { ParentDay, RideView, WeekDay } from '@shared/api';
import { addDays, formatDayRu, localDate, localTime } from '@shared/time';
import { plural } from '@shared/ru';

const ACTIVE = ['driver_en_route', 'driver_arrived', 'on_board'];

export function Home() {
  const { me } = useAuth();
  const toast = useToast();
  const unread = useUnread();
  const [day, setDay] = useState<ParentDay | null>(null);
  const [rides, setRides] = useState<RideView[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [absence, setAbsence] = useState(false);
  const canOrder = !!me?.families.some((f) => f.canEdit) || !!me?.roles.includes('dispatcher');

  const load = useCallback(async () => {
    const today = localDate();
    const [d, w1, w2, c] = await Promise.all([
      api.get<ParentDay>('/parent/day'),
      api.get<WeekDay[]>(`/parent/week?date=${today}`),
      api.get<WeekDay[]>(`/parent/week?date=${addDays(today, 7)}`),
      api.get<ChangeRow[]>('/parent/changes'),
    ]);
    setDay(d);
    setRides([...w1, ...w2].flatMap((x) => x.rides).filter((r) => r.date >= today && r.status !== 'cancelled'));
    setChanges(c);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });

  // семью ещё не подключили — экран «Сегодня» объясняет, что делать
  if (me && !me.families.length && !me.roles.includes('dispatcher')) return <Today />;
  if (!day)
    return (
      <main className="page">
        <div className="empty">Загрузка…</div>
      </main>
    );

  const today = localDate();
  const now = localTime();
  const live = day.rides.find((r) => ACTIVE.includes(r.status));
  const todayAll = day.rides.filter((r) => r.status !== 'cancelled');
  const todayLeft = todayAll.filter((r) => !['delivered', 'no_show'].includes(r.status) && r.pickupTime >= now);
  const next = rides.find((r) => r.date > today || r.pickupTime >= now);
  const weekCount = rides.filter((r) => r.date <= addDays(today, 6)).length;
  const waiting = changes.filter((c) => c.status === 'new').length;
  const lastAnswer = changes.find((c) => c.status === 'accepted' || c.status === 'declined');

  const todayText = live
    ? `${live.child.firstName}: ${live.statusLabel.toLowerCase()}`
    : todayLeft.length
      ? `${todayLeft[0].pickupTime} ${todayLeft[0].child.firstName}: ${todayLeft[0].from.name} → ${todayLeft[0].to.name}${todayLeft.length > 1 ? ` и ещё ${todayLeft.length - 1}` : ''}`
      : todayAll.length
        ? 'Поездки на сегодня закончились'
        : 'Сегодня поездок нет';

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">{day.children.map((c) => c.firstName).join(', ') || 'НА МЕСТЕ'}</h1>
        <span className="page-sub">{formatDayRu(today)}</span>
      </div>
      <nav className="tiles" aria-label="Разделы">
        <Tile to="/app/today" title="Сегодня" sub={todayText} accent={!!live} icon={<IconCar />} />
        <Tile
          to="/app/week"
          title="Неделя"
          sub={
            weekCount
              ? `${weekCount} ${plural(weekCount, ['поездка', 'поездки', 'поездок'])}${next ? ` · дальше ${next.date === today ? 'сегодня' : formatDayRu(next.date)} в ${next.pickupTime}` : ''}`
              : 'Поездок на неделе нет'
          }
          icon={<IconCalendar />}
        />
        {canOrder && <Tile onClick={() => setAbsence(true)} title="Ребёнка не будет" sub="Болезнь, отпуск — диспетчер отменит поездки" icon={<IconPause />} />}
        {canOrder && <Tile to="/app/new" title="Новая поездка" sub="Разовая или по расписанию — заявка диспетчеру" icon={<IconPlus />} />}
        {(waiting > 0 || lastAnswer) && (
          <Tile
            to="/app/week"
            title="Просьбы диспетчеру"
            sub={waiting ? `${waiting} ${plural(waiting, ['ждёт', 'ждут', 'ждут'])} ответа` : `${lastAnswer!.status === 'accepted' ? 'Принято' : 'Не принято'}: ${lastAnswer!.title}`}
            accent={waiting > 0}
            icon={<IconClock />}
          />
        )}
        <Tile
          to="/app/chat"
          title="Чат с диспетчером"
          sub={unread ? `${unread} ${plural(unread, ['новое сообщение', 'новых сообщения', 'новых сообщений'])}` : 'Вопросы, изменения, пожелания'}
          accent={unread > 0}
          icon={<IconChat />}
        />
      </nav>
      <AbsenceSheet
        open={absence}
        onClose={() => setAbsence(false)}
        onDone={(m) => {
          toast.show(m);
          void load();
        }}
      />
      {toast.node}
    </main>
  );
}
