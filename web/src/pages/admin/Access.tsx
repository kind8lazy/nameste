// Водители и доступ: все, кто входит в приложение, коды входа и новые сотрудники.
// В строке — кто это и когда заходил; код и отключение входа — под «⋯».
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast, Sheet, Skeleton } from '../../components/ui';
import { Clock } from '../../components/Clock';
import { DeskNav } from './DeskNav';
import { Block, MoreButton, PanelSheet, type Panel } from './Panels';
import { formatPhone } from '@shared/phone';

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
const lastSeen = (iso: string | null) => (iso ? `заходил ${new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'ещё не заходил');

export function Access() {
  const { me } = useAuth();
  const toast = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [codes, setCodes] = useState<Record<string, { code: string; link: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [staff, setStaff] = useState(false);

  const load = useCallback(async () => setPeople(await api.get<Person[]>('/admin/people')), []);
  useEffect(() => {
    void load().catch(() => setPeople([]));
  }, [load]);

  const issue = async (id: string) => {
    setPanel(null);
    try {
      const r = await api.post<{ code: string; link: string }>(`/admin/users/${id}/invite`);
      setCodes((c) => ({ ...c, [id]: r }));
    } catch (e) {
      toast.show((e as Error).message);
    }
  };
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  };

  const staffList = (people ?? []).filter((p) => p.roles.some((r) => r !== 'parent'));
  const parents = (people ?? []).filter((p) => p.roles.every((r) => r === 'parent'));

  const row = (p: Person) => (
    <li key={p.id} className="fc-row">
      <span className="fc-main">
        <b>
          {p.name} <span className="fc-muted">· {p.roles.map((r) => ROLE_RU[r] ?? r).join(', ')}</span>
        </b>
        <small>{[p.phone ? formatPhone(p.phone) : null, p.car, ...p.families, p.yandex ? 'Яндекс' : null, lastSeen(p.lastLogin)].filter(Boolean).join(' · ')}</small>
        {codes[p.id] && (
          <span className="fc-code">
            <b className="mono">{codes[p.id].code}</b>
            <button className="btn small secondary" onClick={() => copy(p.id, codes[p.id].code)}>
              {copied === p.id ? 'Скопировано' : 'Скопировать код'}
            </button>
            <button className="btn small secondary" onClick={() => copy(`${p.id}l`, codes[p.id].link)}>
              {copied === `${p.id}l` ? 'Скопировано' : 'Ссылка для входа'}
            </button>
          </span>
        )}
      </span>
      <MoreButton
        label={`Действия: ${p.name}`}
        onClick={() =>
          setPanel({
            kind: 'menu',
            title: p.name,
            sub: p.roles.map((r) => ROLE_RU[r] ?? r).join(', '),
            actions: [
              { label: 'Выдать код входа', onClick: () => void issue(p.id) },
              ...(p.id !== me?.id
                ? [
                    {
                      label: 'Отключить вход',
                      danger: true,
                      onClick: () =>
                        setPanel({
                          kind: 'confirm' as const,
                          title: `Отключить вход для «${p.name}»?`,
                          text: 'Все его устройства сразу выйдут, неиспользованные коды погаснут. Вернуть доступ можно новым кодом.',
                          confirm: 'Отключить вход',
                          onConfirm: async () => {
                            try {
                              await api.post(`/admin/users/${p.id}/revoke`);
                              setCodes((c) => {
                                const n = { ...c };
                                delete n[p.id];
                                return n;
                              });
                              toast.show('Вход отключён');
                              setPanel(null);
                              await load();
                              return true;
                            } catch (e) {
                              toast.show((e as Error).message);
                              return false;
                            }
                          },
                        }),
                    },
                  ]
                : []),
            ],
          })
        }
      />
    </li>
  );

  return (
    <div className="desk desk-2">
      <DeskNav />
      <main className="desk-main" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <Clock />
          <h1 className="page-title" style={{ flex: 1 }}>
            Водители и доступ
          </h1>
          <button className="btn small" onClick={() => setStaff(true)}>
            + Сотрудник
          </button>
        </div>
        {!people ? (
          <Skeleton rows={4} />
        ) : (
          <>
            <Block title="Команда" hint="Код входа — если не получается войти через Яндекс. Действует 3 дня, подходит для двух входов, новый код отменяет прежний." empty="Сотрудников пока нет.">
              {staffList.map(row)}
            </Block>
            <Block title="Родители" empty="Родителей пока нет — их добавляют в разделе «Семьи».">
              {parents.map(row)}
            </Block>
          </>
        )}
      </main>
      <PanelSheet panel={panel} onClose={() => setPanel(null)} />
      <Sheet open={staff} onClose={() => setStaff(false)}>
        <NewStaff
          onDone={async (msg) => {
            setStaff(false);
            toast.show(msg);
            await load();
          }}
        />
      </Sheet>
      {toast.node}
    </div>
  );
}

/** Новый сотрудник: у водителя сразу его машина. После — «⋯» → «Выдать код входа». */
function NewStaff({ onDone }: { onDone: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'driver' | 'dispatcher'>('driver');
  const [car, setCar] = useState('');
  const [plate, setPlate] = useState('');
  const [seats, setSeats] = useState('4');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length >= 2 && (role !== 'driver' || (car.trim().length >= 2 && plate.trim().length >= 4));
  return (
    <form
      style={{ display: 'grid', gap: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.post('/admin/staff', { name, role, phone: phone || undefined, car: role === 'driver' ? { title: car, plate, seats: Number(seats) } : undefined });
          onDone(`${name} добавлен. Выдайте код входа через «⋯».`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Новый сотрудник</h3>
      <div className="pick">
        {(['driver', 'dispatcher'] as const).map((r) => (
          <button key={r} type="button" className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
            {r === 'driver' ? 'Водитель' : 'Диспетчер'}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="ns-name">Имя</label>
        <input id="ns-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Надежда" />
      </div>
      <div className="field">
        <label htmlFor="ns-phone">Телефон</label>
        <input id="ns-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 921 000-00-00" />
      </div>
      {role === 'driver' && (
        <>
          <div className="field">
            <label htmlFor="ns-car">Машина</label>
            <input id="ns-car" className="input" value={car} onChange={(e) => setCar(e.target.value)} placeholder="Kia Carnival, белая" />
          </div>
          <div className="btn-row">
            <div className="field">
              <label htmlFor="ns-plate">Госномер</label>
              <input id="ns-plate" className="input" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="А 123 ВС 178" />
            </div>
            <div className="field">
              <label htmlFor="ns-seats">Мест для детей</label>
              <select id="ns-seats" className="input" value={seats} onChange={(e) => setSeats(e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
      {error && <div className="note error">{error}</div>}
      <button className="btn block" disabled={busy || !ready}>
        {busy ? 'Добавляю…' : 'Добавить'}
      </button>
    </form>
  );
}
