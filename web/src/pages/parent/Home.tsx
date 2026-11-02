// Главная родителя: короткий список разделов, у каждого — живая подпись (что сейчас и что дальше).
// Подробности — внутри раздела: «Сегодня» с картой и шагами, «Неделя», чат, просьбы диспетчеру.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
  if (!day) return <main className="page"><div className="empty">Загрузка…</div></main>;

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
          sub={weekCount ? `${weekCount} ${plural(weekCount, ['поездка', 'поездки', 'поездок'])}${next ? ` · дальше ${next.date === today ? 'сегодня' : formatDayRu(next.date)} в ${next.pickupTime}` : ''}` : 'Поездок на неделе нет'}
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
        <Tile to="/app/chat" title="Чат с диспетчером" sub={unread ? `${unread} ${plural(unread, ['новое сообщение', 'новых сообщения', 'новых сообщений'])}` : 'Вопросы, изменения, пожелания'} accent={unread > 0} icon={<IconChat />} />
      </nav>
      <AbsenceSheet open={absence} onClose={() => setAbsence(false)} onDone={(m) => { toast.show(m); void load(); }} />
      {toast.node}
    </main>
  );
}

function Tile({ title, sub, icon, to, onClick, accent }: { title: string; sub: string; icon: ReactNode; to?: string; onClick?: () => void; accent?: boolean }) {
  const body = (
    <>
      <span className="tile-icon">{icon}</span>
      <span className="tile-text">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      <span className="tile-chevron" aria-hidden>
        ›
      </span>
    </>
  );
  const cls = `tile${accent ? ' accent' : ''}`;
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  );
}

const svg = (d: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const IconCar = () => svg(<><path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16" /><rect x="3" y="16" width="18" height="4" rx="1.5" /><circle cx="7.5" cy="20" r="1" /><circle cx="16.5" cy="20" r="1" /></>);
const IconCalendar = () => svg(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
const IconPause = () => svg(<><circle cx="12" cy="12" r="8.5" /><path d="M10 9v6M14 9v6" /></>);
const IconPlus = () => svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></>);
const IconClock = () => svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
const IconChat = () => svg(<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V16h0A2.5 2.5 0 0 1 4 13.5z" />);
