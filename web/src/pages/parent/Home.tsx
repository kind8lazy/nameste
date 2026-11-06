// Главная родителя — «Запланированные поездки». Всё на одной странице, без разделов-плиток:
// строка состояния (что сейчас), неделя полосой (листается пальцем), дети, поездки выбранного дня.
// Новая поездка — «+» в углу, «Ребёнка не будет» — одна большая кнопка под списком.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { groupTrips, tripState } from '../../lib/trips';
import { Tag, useToast, Skeleton } from '../../components/ui';
import { Clock } from '../../components/Clock';
import { RideSheet } from './RideSheet';
import { AbsenceSheet, Waiting, undoable } from './Requests';
import { Today } from './Today';
import { PushCard } from '../../components/PushCard';
import { ChatBox } from '../../components/Chat';
import { isIOS, isStandalone, pushSupported } from '../../lib/platform';
import type { ParentDay, RideView, WeekDay } from '@shared/api';
import type { Tone } from '@shared/domain';
import { addDays, formatDayRu, localDate, localTime, WEEKDAYS_SHORT, weekStart } from '@shared/time';
import { plural, TRIPS } from '@shared/ru';

const ACTIVE = ['driver_en_route', 'driver_arrived', 'on_board'];
/** Сколько недель вперёд можно пролистать полосу. */
const WEEKS = 4;

export function Home() {
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const canOrder = !!me?.families.some((f) => f.canEdit) || !!me?.roles.includes('dispatcher');
  const today = localDate();
  const monday0 = weekStart(today);
  const [selected, setSelected] = useState(() => {
    const d = params.get('date');
    return d && d >= monday0 && d < addDays(monday0, WEEKS * 7) ? d : today;
  });
  const [child, setChild] = useState<string | null>(null);
  const [day, setDay] = useState<ParentDay | null>(null);
  const [weeks, setWeeks] = useState<WeekDay[] | null>(null);
  const [sheet, setSheet] = useState<RideView[] | null>(null);
  const [absence, setAbsence] = useState(false);
  const pager = useRef<HTMLDivElement>(null);
  // уведомления спрашиваем один раз: «Не сейчас» прячет вопрос на этом телефоне (включить можно в «Профиле»)
  const [pushLater, setPushLater] = useState(() => {
    try {
      return localStorage.getItem('push-later') === '1';
    } catch {
      return false;
    }
  });

  const load = useCallback(async () => {
    const [d, ...w] = await Promise.all([api.get<ParentDay>('/parent/day'), ...Array.from({ length: WEEKS }, (_, i) => api.get<WeekDay[]>(`/parent/week?date=${addDays(monday0, i * 7)}`))]);
    setDay(d);
    setWeeks(w.flat());
  }, [monday0]);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });

  // полоса недель стоит на неделе выбранного дня
  const weekIdx = Math.max(0, Math.min(WEEKS - 1, Math.floor((Date.parse(weekStart(selected)) - Date.parse(monday0)) / (7 * 864e5))));
  useEffect(() => {
    const el = pager.current;
    if (el) el.scrollTo({ left: weekIdx * el.clientWidth });
    // только при первом показе: дальше полосу листает человек
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!weeks]);

  const pick = (date: string) => {
    setSelected(date);
    setParams(date === today ? {} : { date }, { replace: true });
  };
  // пролистали полосу на другую неделю — выбираем её первый день (или сегодня, если вернулись)
  const onSwipe = () => {
    const el = pager.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== weekIdx) pick(i === 0 ? today : addDays(monday0, i * 7));
  };

  const ridesOf = (date: string) => (weeks?.find((w) => w.date === date)?.rides ?? []).filter((r) => !child || r.child.id === child);
  const trips = useMemo(() => groupTrips(ridesOf(selected)), [weeks, selected, child]); // eslint-disable-line react-hooks/exhaustive-deps

  // семью ещё не подключили — экран «Сегодня» объясняет, что делать
  if (me && !me.families.length && !me.roles.includes('dispatcher')) return <Today />;
  if (!day || !weeks)
    return (
      <main className="page">
        <Skeleton rows={4} />
      </main>
    );

  const now = localTime();
  const future = weeks.flatMap((w) => w.rides).filter((r) => r.status !== 'cancelled' && (r.date > today || (r.date === today && !['delivered', 'no_show'].includes(r.status))));
  const planned = future.length > 0;
  const live = day.rides.find((r) => ACTIVE.includes(r.status));
  const todayAll = day.rides.filter((r) => r.status !== 'cancelled');
  const todayLeft = todayAll.filter((r) => !['delivered', 'no_show'].includes(r.status) && r.pickupTime >= now);
  const todayText = live
    ? `${live.child.firstName} — ${live.statusLabel.toLowerCase()}${live.status === 'on_board' && live.eta ? `, будет на «${live.to.name}» в ${live.eta}` : ''}`
    : todayLeft.length
      ? `в ${todayLeft[0].pickupTime} — ${todayLeft[0].child.firstName}, ${todayLeft[0].from.name} → ${todayLeft[0].to.name}`
      : todayAll.length
        ? 'поездки закончились'
        : 'поездок нет';
  const laterTrip = future.filter((r) => r.date > today).sort((x, y) => (x.date + x.pickupTime).localeCompare(y.date + y.pickupTime))[0];
  const dayWord = (d: string) => (d === today ? 'сегодня' : d === addDays(today, 1) ? 'завтра' : formatDayRu(d));
  const tomorrow = addDays(today, 1);
  const tomorrowPlanned = weeks.find((d) => d.date === tomorrow)?.rides.filter((r) => r.status === 'planned') ?? [];
  const month = new Date(`${addDays(monday0, weekIdx * 7 + 3)}T12:00:00`).toLocaleString('ru-RU', { month: 'long' });

  return (
    <main className="page">
      <div className="page-head trips-head">
        <Clock />
        <h1 className={`page-title${planned ? '' : ' big'}`}>{planned ? 'Запланированные поездки' : 'Запланируйте поездки своего ребёнка'}</h1>
        {canOrder && (
          <button className="plus-btn" aria-label="Новая поездка" title="Новая поездка" onClick={() => nav(`/app/new${selected > today ? `?date=${selected}` : ''}`)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {/* без поездок — только подсказка: заказ открывает «+» в углу, второй кнопки не нужно */}
      {!planned && (
        <div className="first-run">
          <p>{canOrder ? 'Нажмите «+» вверху: кого, откуда, куда и когда — остальное сделает диспетчер.' : 'Поездки появятся здесь, когда диспетчер их запланирует.'}</p>
        </div>
      )}

      {/* «Сегодня» — строка состояния, а не кнопка (так просила Анастасия) */}
      {planned && (
        <p className="today-line" role="status">
          {live && <span className="dot" aria-hidden />}
          <span>
            <b>Сегодня:</b> {todayText}
            {!live && !todayLeft.length && laterTrip && <span className="muted"> · дальше {dayWord(laterTrip.date)} в {laterTrip.pickupTime}</span>}
          </span>
        </p>
      )}

      {planned && (
      <section className="card week-card">
        <div className="week-month">{month[0].toUpperCase() + month.slice(1)}</div>
        <div className="week-pager" ref={pager} onScroll={() => window.requestAnimationFrame(onSwipe)}>
          {Array.from({ length: WEEKS }, (_, w) => (
            <div className="week-strip plain" role="tablist" key={w}>
              {Array.from({ length: 7 }, (_, i) => addDays(monday0, w * 7 + i)).map((d, i) => {
                const n = groupTrips(ridesOf(d).filter((r) => r.status !== 'cancelled')).length;
                return (
                  <button key={d} role="tab" aria-selected={d === selected} aria-label={`${d}${n ? `, ${n} ${plural(n, TRIPS)}` : ''}`} className={`${d === selected ? 'on' : ''}${d === today ? ' today' : ''}${d < today ? ' past' : ''}`} onClick={() => pick(d)}>
                    {WEEKDAYS_SHORT[i]}
                    <b>{Number(d.slice(8))}</b>
                    <em>{n ? '•' : ''}</em>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      )}

      {planned && day.children.length > 1 && (
        <div className="chips" role="tablist" aria-label="Дети">
          <button role="tab" aria-selected={!child} className={!child ? 'on' : ''} onClick={() => setChild(null)}>
            Все
          </button>
          {day.children.map((c) => (
            <button key={c.id} role="tab" aria-selected={child === c.id} className={child === c.id ? 'on' : ''} onClick={() => setChild(c.id)}>
              {c.firstName}
            </button>
          ))}
        </div>
      )}

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
            {selected !== tomorrow && (
              <button className="btn small secondary" onClick={() => pick(tomorrow)}>
                Посмотреть
              </button>
            )}
          </div>
        </div>
      )}

      {params.get('sent') && <div className="note">Заявка отправлена. Диспетчер ответит уведомлением.</div>}

      {planned &&
        (trips.length === 0 ? (
          <div className="card empty">В этот день поездок нет.</div>
        ) : (
          <ul className="list">
            {trips.map((t) => {
              const s = tripState(t);
              const off = t.rides.filter((r) => r.status === 'cancelled');
              // метка — только у особого статуса; поездка без метки идёт по плану
              const tag: [Tone, string] | null = s.cancelled ? ['muted', 'отменена'] : s.live ? ['gold', 'сейчас'] : s.done ? ['ok', 'на месте'] : t.rides.some((r) => r.pending) ? ['plan', 'ждёт ответа'] : null;
              return (
                <li key={t.key}>
                  <button className={`row${s.cancelled ? ' cancelled' : ''}`} onClick={() => (s.live ? nav('/app/today') : setSheet(t.rides))}>
                    <time>{t.pickupTime}</time>
                    <span className="main">
                      <b>{t.rides.filter((r) => r.status !== 'cancelled' || s.cancelled).map((r) => r.child.firstName).join(', ')}</b>
                      <small>
                        {t.fromName} → {[...new Set(t.rides.map((r) => r.to.name))].join(', ')}
                        {off.length && !s.cancelled ? ` · отмена: ${off.map((r) => r.child.firstName).join(', ')}` : ''}
                      </small>
                    </span>
                    {tag && <Tag tone={tag[0]}>{tag[1]}</Tag>}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

      <Waiting />

      {/* одна из двух главных кнопок родителя (вторая — «+»): заметная, как просила Анастасия */}
      {canOrder && planned && (
        <button className="btn secondary block" onClick={() => setAbsence(true)}>
          Ребёнка не будет
        </button>
      )}

      {planned && !pushLater && !me?.pushEnabled && ((isIOS() && !isStandalone()) || pushSupported()) && (
        <div className="push-once">
          <PushCard compact />
          <button
            className="text-link"
            style={{ color: 'var(--mute)', fontWeight: 400 }}
            onClick={() => {
              setPushLater(true);
              try {
                localStorage.setItem('push-later', '1');
              } catch {
                /* приватный режим — спросим снова в следующий раз */
              }
            }}
          >
            Не сейчас
          </button>
        </div>
      )}

      {/* чат с диспетчером — большим квадратом внизу, писать сразу */}
      <ChatBox />

      <RideSheet rides={sheet} onClose={() => setSheet(null)} onDone={undoable(toast, () => void load())} />
      <AbsenceSheet open={absence} onClose={() => setAbsence(false)} onDone={undoable(toast, () => void load())} />
      {toast.node}
    </main>
  );
}
