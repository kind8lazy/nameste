// Семьи: поиск и список; «+ Семья» — в нижней панели. Всё остальное о семье — в её карточке.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useToast, Sheet, Skeleton } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { localDate, WEEKDAYS_SHORT, weekday } from '@shared/time';
import { formatRule } from '@shared/recurrence';
import { formatPhone } from '@shared/phone';
import { plural } from '@shared/ru';
import { Clock } from '../../components/Clock';
import { DeskNav } from './DeskNav';

export interface Family {
  id: string;
  name: string;
  members: { userId: string; name: string; phone: string | null; email: string | null; yandex: boolean; relation: string; isOwner: boolean }[];
  children: { id: string; firstName: string; grade: string | null }[];
  templates: { id: string; time: string; ruleText: string; priceRub: number; childId: string; driverId: string | null }[];
}
export interface Place {
  id: string;
  name: string;
  address: string;
}
interface Pending {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}
export function Clients() {
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    const [f, u] = await Promise.all([api.get<Family[]>('/admin/families'), api.get<Pending[]>('/admin/pending-users')]);
    setFamilies(f);
    setPending(u);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.show(ok);
      await load();
      return true;
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Не получилось');
      return false;
    }
  };

  // ищем по названию семьи, детям, взрослым и телефону
  const needle = q.trim().toLowerCase();
  const shown = (families ?? []).filter(
    (f) => !needle || [f.name, ...f.children.map((c) => c.firstName), ...f.members.flatMap((m) => [m.name, m.phone ?? ''])].some((x) => x.toLowerCase().includes(needle)),
  );

  return (
    <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>
      <DeskNav />
      <main className="desk-main" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <Clock />
          <h1 className="page-title" style={{ flex: 1 }}>
            Семьи
          </h1>
          <button className="btn small" onClick={() => setAdding(true)}>
            + Семья
          </button>
        </div>

        {pending.length > 0 && (
          <section className="fc-block">
            <div className="fc-head">
              <h3>Вошли через Яндекс и ждут семью</h3>
            </div>
            {pending.map((u) => (
              <Attach key={u.id} user={u} families={families ?? []} run={run} />
            ))}
          </section>
        )}

        <input className="input" type="search" placeholder="Поиск: семья, ребёнок, родитель или телефон" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск семьи" />

        {!families ? (
          <Skeleton rows={4} />
        ) : shown.length ? (
          <ul className="list">
            {shown.map((f) => (
              <li key={f.id}>
                <Link to={`/admin/clients/${f.id}`} className="fc-row fc-link">
                  <span className="fc-main">
                    <b>{f.name}</b>
                    <small>
                      {[f.children.map((c) => c.firstName).join(', ') || 'детей нет', f.templates.length ? `${f.templates.length} ${plural(f.templates.length, ['поездка', 'поездки', 'поездок'])} по расписанию` : 'поездок нет', f.members.map((m) => m.name).join(', ')].join(' · ')}
                    </small>
                  </span>
                  <span className="tile-chevron" aria-hidden>
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card empty" style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
            {needle ? 'Никого не нашли — проверьте написание.' : 'Семей пока нет.'}
            {!needle && (
              <button className="btn" onClick={() => setAdding(true)}>
                Добавить первую семью
              </button>
            )}
          </div>
        )}
      </main>
      <Sheet open={adding} onClose={() => setAdding(false)}>
        <NewFamily
          run={async (fn, ok) => {
            const done = await run(fn, ok);
            if (done) setAdding(false);
            return done;
          }}
        />
      </Sheet>
      {toast.node}
    </div>
  );
}

export type Run = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

function Attach({ user, families, run }: { user: Pending; families: Family[]; run: Run }) {
  const [familyId, setFamilyId] = useState('');
  const [owner, setOwner] = useState(false);
  return (
    <div className="card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, display: 'grid' }}>
        <b>{user.name}</b>
        <small className="page-sub">
          {[user.phone ? formatPhone(user.phone) : 'телефона в Яндексе нет', user.email ?? 'почты нет'].join(' · ')}
        </small>
        <small className="page-sub">Имя человек указал в Яндексе сам — сверьте телефон или почту, прежде чем привязывать.</small>
      </span>
      <select className="input" style={{ width: 200 }} value={familyId} onChange={(e) => setFamilyId(e.target.value)} aria-label="Семья">
        <option value="">Выберите семью</option>
        {families.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <select className="input" style={{ width: 190 }} value={owner ? 'owner' : 'view'} onChange={(e) => setOwner(e.target.value === 'owner')} aria-label="Права">
        <option value="view">только смотреть</option>
        <option value="owner">управлять поездками</option>
      </select>
      <button className="btn small" disabled={!familyId} onClick={() => run(() => api.post(`/admin/families/${familyId}/attach`, { userId: user.id, relation: 'родитель', isOwner: owner }), 'Привязан к семье')}>
        Привязать
      </button>
    </div>
  );
}

function NewFamily({ run }: { run: Run }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relation, setRelation] = useState('мама');
  const [kids, setKids] = useState('');
  return (
    <form
      className="card"
      style={{ padding: 14, display: 'grid', gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const children = kids.split(',').map((k) => k.trim()).filter(Boolean).map((firstName) => ({ firstName }));
        const ok = await run(() => api.post('/admin/families', { name: name || `Семья ${parent}`, parent: { name: parent, phone: phone || undefined, email, relation }, children }), 'Семья добавлена');
        if (ok) {
          setName('');
          setParent('');
          setPhone('');
          setEmail('');
          setKids('');
        }
      }}
    >
      <h3>Новая семья</h3>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field">
          <label htmlFor="nf-parent">Родитель</label>
          <input id="nf-parent" className="input" placeholder="Ольга" value={parent} onChange={(e) => setParent(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nf-email">Почта (Яндекс) — сюда придёт «ребёнок на месте»</label>
          <input id="nf-email" type="email" className="input" placeholder="name@yandex.ru" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nf-phone">Телефон</label>
          <input id="nf-phone" className="input" placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nf-rel">Кто это</label>
          <select id="nf-rel" className="input" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option>мама</option>
            <option>папа</option>
            <option>бабушка</option>
            <option>няня</option>
          </select>
        </div>
      </div>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field">
          <label htmlFor="nf-kids">Дети через запятую</label>
          <input id="nf-kids" className="input" placeholder="Соня, Миша" value={kids} onChange={(e) => setKids(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nf-name">Название семьи (необязательно)</label>
          <input id="nf-name" className="input" placeholder="Семья Ольги" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <button className="btn" disabled={parent.trim().length < 2 || !kids.trim()}>
        Добавить семью
      </button>
    </form>
  );
}

export interface DriverOption {
  id: string;
  name: string;
  car: string | null;
  plate: string | null;
  main: boolean;
}

/** Водители для выбора «кто везёт»; первый — основной. */
export function useDrivers() {
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  useEffect(() => {
    api.get<DriverOption[]>('/admin/drivers').then(setDrivers).catch(() => setDrivers([]));
  }, []);
  return drivers;
}

export const driverLabel = (d: DriverOption) => [d.name, d.car, d.plate].filter(Boolean).join(' · ') + (d.main ? ' (основной)' : '');

export function NewTemplate({ families, places, run, fixedFamilyId }: { families: Family[]; places: Place[]; run: Run; fixedFamilyId?: string }) {
  const lite = !!useAuth().me?.lite;
  const [familyId, setFamilyId] = useState(fixedFamilyId ?? '');
  const [childId, setChildId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [time, setTime] = useState('14:20');
  const [date, setDate] = useState(localDate());
  const [once, setOnce] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [price, setPrice] = useState(1000);
  const drivers = useDrivers();
  const [driverId, setDriverId] = useState('');
  const family = families.find((f) => f.id === familyId);
  const rule = once ? 'ONCE' : formatRule({ freq: 'WEEKLY', interval: 1, byDay: days.length ? days : [weekday(date)] });
  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <h3>Новая поездка</h3>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={fixedFamilyId ? { display: 'none' } : undefined}>
          <label htmlFor="nt-fam">Семья</label>
          <select id="nt-fam" className="input" value={familyId} onChange={(e) => { setFamilyId(e.target.value); setChildId(''); }}>
            <option value="">Выберите</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nt-child">Ребёнок</label>
          <select id="nt-child" className="input" value={childId} onChange={(e) => setChildId(e.target.value)}>
            <option value="">Выберите</option>
            {family?.children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        {(
          [
            ['Откуда', from, setFrom, 'nt-from'],
            ['Куда', to, setTo, 'nt-to'],
          ] as [string, string, (v: string) => void, string][]
        ).map(([label, value, set, id]) => (
          <div className="field" key={id}>
            <label htmlFor={id}>{label}</label>
            <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)}>
              <option value="">Выберите место</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.address.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field">
          <label htmlFor="nt-date">{once ? 'Дата' : 'Начиная с'}</label>
          <input id="nt-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nt-time">Забрать в</label>
          <input id="nt-time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {drivers.length > 1 && (
          <div className="field">
            <label htmlFor="nt-driver">Кто везёт</label>
            <select id="nt-driver" className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              {drivers.map((d) => (
                <option key={d.id} value={d.main ? '' : d.id}>
                  {driverLabel(d)}
                </option>
              ))}
            </select>
          </div>
        )}
        {!lite && (
          <div className="field">
            <label htmlFor="nt-price">Цена, ₽</label>
            <input id="nt-price" type="number" className="input" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </div>
        )}
      </div>
      <div className="pick">
        <button className={once ? 'on' : ''} style={{ color: once ? undefined : 'inherit' }} onClick={() => setOnce(true)}>
          Разово
        </button>
        <button className={!once ? 'on' : ''} style={{ color: !once ? undefined : 'inherit' }} onClick={() => setOnce(false)}>
          Каждую неделю
        </button>
        {!once &&
          WEEKDAYS_SHORT.map((d, i) => (
            <button key={d} className={days.includes(i + 1) ? 'on' : ''} style={{ color: days.includes(i + 1) ? undefined : 'inherit' }} onClick={() => setDays((x) => (x.includes(i + 1) ? x.filter((y) => y !== i + 1) : [...x, i + 1].sort()))}>
              {d}
            </button>
          ))}
      </div>
      <button
        className="btn"
        disabled={!familyId || !childId || !from || !to || from === to || !time}
        onClick={async () => {
          const added = await run(async () => {
            await api.post('/admin/templates', { familyId, childId, fromPlaceId: from, toPlaceId: to, time, rule, startDate: date, driverId: driverId || undefined, ...(lite ? {} : { priceRub: price }) });
            await api.post(`/admin/days/${date}/plan`);
          }, `Поездка ${time} добавлена. Форма готова для обратной поездки — укажите время.`);
          // после добавления форма сразу готова для обратной дороги: адреса меняются местами, время пустое
          if (added) {
            setFrom(to);
            setTo(from);
            setTime('');
          }
        }}
      >
        Добавить поездку
      </button>
    </div>
  );
}
