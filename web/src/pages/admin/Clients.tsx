// Клиенты: завести семью с почтой родителя, место по адресу и поездку. Этого достаточно,
// чтобы после свайпа водителя «Передал» родителю ушло письмо «ребёнок на месте» на Яндекс Почту.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { localDate, WEEKDAYS_SHORT, weekday } from '@shared/time';
import { formatRule } from '@shared/recurrence';
import { formatPhone } from '@shared/phone';

export interface Family {
  id: string;
  name: string;
  members: { userId: string; name: string; phone: string | null; email: string | null; yandex: boolean; relation: string; isOwner: boolean }[];
  children: { id: string; firstName: string; grade: string | null }[];
  templates: { id: string; time: string; ruleText: string; priceRub: number; childId: string }[];
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
interface Status {
  provider: string;
  testMode: boolean;
  mail: string;
  mailFrom: string;
  yandex: boolean;
  demo: boolean;
}
export function Clients() {
  const lite = !!useAuth().me?.lite;
  const [families, setFamilies] = useState<Family[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const [f, u, s] = await Promise.all([
      api.get<Family[]>('/admin/families'),
      api.get<Pending[]>('/admin/pending-users'),
      api.get<Status>('/admin/sms'),
    ]);
    setFamilies(f);
    setPending(u);
    setStatus(s);
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

  return (
    <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>
      <nav className="desk-nav">
        <div className="wordmark">
          НА<i />МЕСТЕ
        </div>
        <Link to="/admin">Диспетчерская</Link>
        <a className="active">Клиенты</a>
        <Link to="/admin/chat">Сообщения</Link>
      </nav>
      <main className="desk-main" style={{ maxWidth: 980 }}>
        <h1 className="page-title">Клиенты</h1>

        {status && (
          <div className="kpis">
            <span className="kpi">
              письма на почту<b>{status.mail === 'none' ? 'выключены' : status.mail === 'log' ? 'проверка без отправки' : `включены · ${status.mailFrom}`}</b>
            </span>
            {status.provider !== 'none' && (
              <span className="kpi">
                SMS<b>{status.provider === 'log' ? 'проверка без отправки' : `${status.provider === 'yandex' ? 'Яндекс' : 'sms.ru'}, ${status.testMode ? 'тест' : 'боевой'}`}</b>
              </span>
            )}
            <span className="kpi">
              вход через Яндекс<b>{status.yandex ? 'включён' : 'не настроен'}</b>
            </span>
            <span className="kpi">
              демо-режим<b>{status.demo ? 'включён' : 'выключен'}</b>
            </span>
          </div>
        )}
        <MailTest run={run} />

        {pending.length > 0 && (
          <section style={{ display: 'grid', gap: 8 }}>
            <h3>Вошли через Яндекс и ждут семью</h3>
            {pending.map((u) => (
              <Attach key={u.id} user={u} families={families} run={run} />
            ))}
          </section>
        )}

        <People />
        <NewFamily run={run} />

        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Семьи</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Семья</th>
                <th>Взрослые</th>
                <th>Дети</th>
                <th>Поездки по расписанию</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.id}>
                  <td>
                    <b>{f.name}</b>
                    <br />
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <Link to={`/admin/clients/${f.id}`} className="btn small">
                        Открыть карточку
                      </Link>
                      <Link to={`/admin/chat?thread=${encodeURIComponent(`family:${f.id}`)}`} className="btn small secondary">
                        Написать
                      </Link>
                    </span>
                  </td>
                  <td>
                    {f.members.map((m) => (
                      <MemberRow key={m.userId} m={m} run={run} />
                    ))}
                  </td>
                  <td>{f.children.map((c) => c.firstName).join(', ') || '—'}</td>
                  <td>
                    {f.templates.map((t) => (
                      <div key={t.id}>
                        {t.time} {f.children.find((c) => c.id === t.childId)?.firstName} · {t.ruleText}{lite ? '' : ` · ${t.priceRub} ₽`}
                      </div>
                    ))}
                    {!f.templates.length && '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
      {toast.node}
    </div>
  );
}

export type Run = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

interface Person {
  id: string;
  name: string;
  roles: string[];
  phone: string | null;
  email: string | null;
  yandex: boolean;
  families: string[];
  lastLogin: string | null;
  car: string | null;
}

const ROLE_RU: Record<string, string> = { dispatcher: 'диспетчер', driver: 'водитель', parent: 'родитель' };

/** Выдать код входа любому человеку, если вход через Яндекс не получается. Код: 8 цифр, 3 дня, 2 входа. */
function People() {
  const [people, setPeople] = useState<Person[]>([]);
  const [codes, setCodes] = useState<Record<string, { code: string; link: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { me } = useAuth();
  const load = useCallback(() => {
    api.get<Person[]>('/admin/people').then(setPeople).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<'driver' | 'dispatcher'>('driver');
  const [staffPhone, setStaffPhone] = useState('');
  const [carTitle, setCarTitle] = useState('');
  const [carPlate, setCarPlate] = useState('');
  const [carSeats, setCarSeats] = useState('4');
  const addStaff = async () => {
    try {
      const car = staffRole === 'driver' ? { title: carTitle, plate: carPlate, seats: Number(carSeats) } : undefined;
      await api.post('/admin/staff', { name: staffName, role: staffRole, phone: staffPhone || undefined, car });
      setStaffName('');
      setStaffPhone('');
      setCarTitle('');
      setCarPlate('');
      setError(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const issue = async (id: string) => {
    setError(null);
    try {
      const r = await api.post<{ code: string; link: string }>(`/admin/users/${id}/invite`);
      setCodes((c) => ({ ...c, [id]: r }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section id="access" style={{ display: 'grid', gap: 8 }}>
      <h3>Доступ и коды входа</h3>
      <div className="note plain">
        Если у человека не получается войти через Яндекс, выдайте ему код. Он действует 3 дня и подходит для двух входов. Человек вводит его на странице входа в поле «код из приглашения». Новый код отменяет прежний.
      </div>
      {error && <div className="note error">{error}</div>}
      <div className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <b>Добавить сотрудника</b>
        <div className="btn-row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="field">
            <label htmlFor="st-name">Имя</label>
            <input id="st-name" className="input" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="Иван Петров" />
          </div>
          <div className="field">
            <label htmlFor="st-phone">Телефон</label>
            <input id="st-phone" className="input" value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)} placeholder="+7 921 000-00-00" />
          </div>
          <div className="field">
            <label htmlFor="st-role">Кто</label>
            <select id="st-role" className="input" value={staffRole} onChange={(e) => setStaffRole(e.target.value as 'driver' | 'dispatcher')}>
              <option value="driver">водитель</option>
              <option value="dispatcher">диспетчер</option>
            </select>
          </div>
        </div>
        {staffRole === 'driver' && (
          <div className="btn-row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="car-title">Машина водителя</label>
              <input id="car-title" className="input" value={carTitle} onChange={(e) => setCarTitle(e.target.value)} placeholder="Kia Carnival, белая" />
            </div>
            <div className="field">
              <label htmlFor="car-plate">Госномер</label>
              <input id="car-plate" className="input" value={carPlate} onChange={(e) => setCarPlate(e.target.value)} placeholder="А 123 ВС 178" />
            </div>
            <div className="field">
              <label htmlFor="car-seats">Мест для детей</label>
              <select id="car-seats" className="input" value={carSeats} onChange={(e) => setCarSeats(e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <button
          className="btn"
          disabled={staffName.trim().length < 2 || (staffRole === 'driver' && (carTitle.trim().length < 2 || carPlate.trim().length < 4))}
          onClick={addStaff}
        >
          Добавить
        </button>
        <small className="page-sub">После добавления нажмите «Выдать код» в таблице ниже и отправьте код человеку.</small>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Кто</th>
            <th>Роль</th>
            <th>Вход</th>
            <th>Код</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td>
                <b>{p.name}</b>
                <br />
                <small className="page-sub">{[p.phone ? formatPhone(p.phone) : null, p.email, p.car, ...p.families].filter(Boolean).join(' · ') || '—'}</small>
              </td>
              <td>{p.roles.map((r) => ROLE_RU[r] ?? r).join(', ')}</td>
              <td>
                {p.yandex ? <span className="tag tone-ok">Яндекс</span> : <span className="tag tone-plan">без Яндекса</span>}
                <br />
                <small className="page-sub">{p.lastLogin ? `заходил ${new Date(p.lastLogin).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'ещё не заходил'}</small>
              </td>
              <td>
                {codes[p.id] ? (
                  <span style={{ display: 'grid', gap: 4 }}>
                    <b className="mono" style={{ fontSize: 20, letterSpacing: '0.12em', userSelect: 'all' }}>
                      {codes[p.id].code}
                    </b>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn small secondary" onClick={() => copy(p.id, codes[p.id].code)}>
                        {copied === p.id ? 'Скопировано' : 'Скопировать код'}
                      </button>
                      <button className="btn small secondary" onClick={() => copy(p.id + 'l', codes[p.id].link)}>
                        {copied === p.id + 'l' ? 'Скопировано' : 'Скопировать ссылку'}
                      </button>
                    </span>
                  </span>
                ) : (
                  <button className="btn small" onClick={() => issue(p.id)}>
                    Выдать код
                  </button>
                )}
                {p.id !== me?.id && (
                  <button
                    className="btn small danger"
                    style={{ marginLeft: 6 }}
                    onClick={async () => {
                      if (!window.confirm(`Отключить вход для «${p.name}»? Все его устройства сразу выйдут, коды погаснут.`)) return;
                      try {
                        await api.post(`/admin/users/${p.id}/revoke`);
                        setCodes((c) => ({ ...c, [p.id]: undefined as never }));
                        setError(null);
                        load();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Отключить вход
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!people.length && (
            <tr>
              <td colSpan={4} className="page-sub">
                Пока никого нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function MailTest({ run }: { run: Run }) {
  const [email, setEmail] = useState('');
  return (
    <form
      className="card"
      style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await api.post<{ ok: boolean; error?: string }>('/admin/mail/test', { email });
          if (!r.ok) throw new ApiError(400, `Письмо не ушло: ${r.error}`);
        }, 'Проверочное письмо отправлено');
      }}
    >
      <div className="field" style={{ flex: 1, minWidth: 220 }}>
        <label htmlFor="mail-test">Проверить письма: адрес почты</label>
        <input id="mail-test" type="email" className="input" placeholder="name@yandex.ru" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button className="btn" disabled={!email.includes('@')}>
        Отправить проверочное
      </button>
    </form>
  );
}

export function MemberRow({ m, run }: { m: Family['members'][number]; run: Run }) {
  const [edit, setEdit] = useState(false);
  const [email, setEmail] = useState(m.email ?? '');
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
      <span>
        {m.name} ({m.relation}){m.phone ? ` · ${formatPhone(m.phone)}` : ''}
      </span>
      {m.yandex && <span className="tag tone-ok">Яндекс привязан</span>}
      {edit ? (
        <>
          <input className="input" style={{ minHeight: 32, width: 200, fontSize: 14 }} type="email" aria-label="Почта" placeholder="name@yandex.ru" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn small" onClick={async () => (await run(() => api.post(`/admin/users/${m.userId}/contacts`, { email }), 'Почта сохранена')) && setEdit(false)}>
            Сохранить
          </button>
        </>
      ) : m.email ? (
        <button className="tag tone-plan" style={{ border: 0, cursor: 'pointer' }} onClick={() => setEdit(true)} title="Изменить почту">
          {m.email}
        </button>
      ) : (
        <button className="tag tone-warn" style={{ border: 0, cursor: 'pointer' }} onClick={() => setEdit(true)}>
          нет почты — письмо не уйдёт · добавить
        </button>
      )}
    </div>
  );
}

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
        disabled={!familyId || !childId || !from || !to || from === to}
        onClick={() =>
          run(async () => {
            await api.post('/admin/templates', { familyId, childId, fromPlaceId: from, toPlaceId: to, time, rule, startDate: date, ...(lite ? {} : { priceRub: price }) });
            await api.post(`/admin/days/${date}/plan`);
          }, 'Поездка добавлена в расписание')
        }
      >
        Добавить поездку
      </button>
    </div>
  );
}
