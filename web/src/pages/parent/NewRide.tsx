// Заявка на новую поездку или маршрут: кто, откуда, куда, когда, как часто. Цена видна сразу.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import type { ParentDay } from '@shared/api';
import { addDays, localDate, WEEKDAYS_SHORT, weekday } from '@shared/time';
import { formatRule } from '@shared/recurrence';
import { plural, TRIPS } from '@shared/ru';

interface Place {
  id: string;
  name: string;
  address: string;
}
type Repeat = 'once' | 'weekly' | 'biweekly';
const NEW = '__new__';

/** Ближайший будний день после сегодня — поездки в основном по учебным дням. */
function nextWorkday() {
  let d = addDays(localDate(), 1);
  while (weekday(d) > 5) d = addDays(d, 1);
  return d;
}

export function NewRide() {
  const lite = !!useAuth().me?.lite;
  const nav = useNavigate();
  const [day, setDay] = useState<ParentDay | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [kids, setKids] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [fromAddr, setFromAddr] = useState('');
  const [to, setTo] = useState('');
  const [toAddr, setToAddr] = useState('');
  const [date, setDate] = useState(nextWorkday());
  const [time, setTime] = useState('14:20');
  const [repeat, setRepeat] = useState<Repeat>('weekly');
  const [days, setDays] = useState<number[]>([weekday(nextWorkday())]);
  const [escort, setEscort] = useState<'to_door' | 'to_entrance'>('to_door');
  const [comment, setComment] = useState('');
  const [price, setPrice] = useState<{ perTrip: number; tripsIn4Weeks: number; total4Weeks: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<ParentDay>('/parent/day').then((d) => {
      setDay(d);
      setKids(d.children.slice(0, 1).map((c) => c.id));
    });
    void api.get<Place[]>('/parent/places').then(setPlaces);
  }, []);

  const rule = useMemo(() => {
    if (repeat === 'once') return 'ONCE';
    return formatRule({ freq: 'WEEKLY', interval: repeat === 'biweekly' ? 2 : 1, byDay: days.length ? days : [weekday(date)] });
  }, [repeat, days, date]);

  useEffect(() => {
    if (!kids.length || lite) return setPrice(null);
    void api.post<typeof price>('/parent/quote', { children: kids.length, escort, rule, startDate: date }).then(setPrice).catch(() => setPrice(null));
  }, [kids.length, escort, rule, date, lite]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/parent/requests', {
        childIds: kids,
        fromPlaceId: from && from !== NEW ? from : null,
        fromAddress: from === NEW ? fromAddr : null,
        toPlaceId: to && to !== NEW ? to : null,
        toAddress: to === NEW ? toAddr : null,
        time,
        rule,
        startDate: date,
        escort,
        comment: comment || null,
      });
      nav('/app/week?sent=1', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить');
    } finally {
      setBusy(false);
    }
  };

  const placeSelect = (value: string, set: (v: string) => void, addr: string, setAddr: (v: string) => void, id: string) => (
    <>
      <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Выберите место</option>
        {places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.address}
          </option>
        ))}
        <option value={NEW}>Другой адрес…</option>
      </select>
      {value === NEW && <input className="input" placeholder="Улица, дом или название (школа № 56)" value={addr} onChange={(e) => setAddr(e.target.value)} />}
    </>
  );

  const same = !!from && from !== NEW && from === to;
  const ready = kids.length && (from && (from !== NEW || fromAddr.trim())) && (to && (to !== NEW || toAddr.trim())) && !same;

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">Новая поездка</h1>
        <Link to="/app/week" className="page-sub">
          Отмена
        </Link>
      </div>

      {!places.length && (
        <div className="note">
          Сначала добавьте адреса: дом, школу, секции. <Link to="/app/family">Добавить места в разделе «Семья»</Link>. Или выберите «Другой адрес…» и впишите его вручную.
        </div>
      )}

      <div className="field">
        <label>Кто едет</label>
        <div className="kids">
          {day?.children.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`kid-chip${kids.includes(c.id) ? ' on' : ''}`}
              style={{ cursor: 'pointer' }}
              aria-pressed={kids.includes(c.id)}
              onClick={() => setKids((k) => (k.includes(c.id) ? k.filter((x) => x !== c.id) : [...k, c.id]))}
            >
              <Avatar child={c} size={24} />
              {c.firstName}
              {kids.includes(c.id) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="from">Откуда забрать</label>
        {placeSelect(from, setFrom, fromAddr, setFromAddr, 'from')}
      </div>
      <div className="field">
        <label htmlFor="to">Куда отвезти</label>
        {placeSelect(to, setTo, toAddr, setToAddr, 'to')}
      </div>

      <div className="btn-row">
        <div className="field">
          <label htmlFor="date">{repeat === 'once' ? 'Дата' : 'Начиная с'}</label>
          <input id="date" type="date" className="input" value={date} min={localDate()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="time">Забрать в</label>
          <input id="time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Как часто</label>
        <div className="pick">
          {(
            [
              ['once', 'Разово'],
              ['weekly', 'Каждую неделю'],
              ['biweekly', 'Через неделю'],
            ] as [Repeat, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" className={repeat === v ? 'on' : ''} style={{ color: repeat === v ? undefined : 'inherit' }} onClick={() => setRepeat(v)}>
              {l}
            </button>
          ))}
        </div>
        {repeat !== 'once' && (
          <div className="pick">
            {WEEKDAYS_SHORT.map((d, i) => (
              <button
                key={d}
                type="button"
                className={days.includes(i + 1) ? 'on' : ''}
                style={{ color: days.includes(i + 1) ? undefined : 'inherit' }}
                onClick={() => setDays((x) => (x.includes(i + 1) ? x.filter((y) => y !== i + 1) : [...x, i + 1].sort()))}
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label>Сопровождение</label>
        <div className="pick">
          <button type="button" className={escort === 'to_door' ? 'on' : ''} style={{ color: escort === 'to_door' ? undefined : 'inherit' }} onClick={() => setEscort('to_door')}>
            До кабинета, передать взрослому
          </button>
          <button type="button" className={escort === 'to_entrance' ? 'on' : ''} style={{ color: escort === 'to_entrance' ? undefined : 'inherit' }} onClick={() => setEscort('to_entrance')}>
            До входа
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="comment">Комментарий диспетчеру</label>
        <textarea id="comment" className="input" rows={3} style={{ paddingTop: 10 }} placeholder="Например: занятие заканчивается в 16:30, выходит через главный вход" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>

      {lite && <div className="note plain">Диспетчер проверит время и подтвердит заявку.</div>}
      {price && (
        <div className="note">
          <b>
            {price.perTrip.toLocaleString('ru-RU')} ₽ за поездку
            {kids.length > 1 ? ` за ${kids.length} детей` : ''}
          </b>
          {repeat !== 'once' && (
            <span>
              За 4 недели: {price.tripsIn4Weeks} {plural(price.tripsIn4Weeks, TRIPS)} ≈ {price.total4Weeks.toLocaleString('ru-RU')} ₽
            </span>
          )}
          <span>Цена предварительная. Диспетчер проверит время и подтвердит.</span>
        </div>
      )}
      {same && <div className="note error">Откуда и куда — одно и то же место. Выберите разные.</div>}
      {error && <div className="note error">{error}</div>}
      <button className="btn block" disabled={!ready || busy} onClick={submit}>
        {busy ? 'Отправляю…' : 'Отправить заявку'}
      </button>
    </main>
  );
}
