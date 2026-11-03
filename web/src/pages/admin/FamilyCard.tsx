// Карточка семьи: взрослые и вход, дети, места, поездки по расписанию.
// Спокойный экран: в строке — главное, редкие действия — под «⋯» в нижней панели, удаление — только с подтверждением.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast, Skeleton, BackButton, Sheet } from '../../components/ui';
import { Block, MoreButton, PanelSheet, type Panel } from './Panels';
import { useAuth } from '../../lib/auth';
import { PlaceForm, type PlacePayload } from '../../components/PlaceForm';
import { NewTemplate, useDrivers, type Family, type Place, type Run } from './Clients';
import { Clock } from '../../components/Clock';
import { DeskNav } from './DeskNav';
import { formatPhone } from '@shared/phone';

interface PlaceRow extends Place {
  familyId: string | null;
  entranceNote: string | null;
}

export function FamilyCard() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const lite = !!useAuth().me?.lite;
  const [family, setFamily] = useState<Family | null | undefined>(undefined);
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [codes, setCodes] = useState<Record<string, { code: string; link: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const drivers = useDrivers();
  const toast = useToast();

  const load = useCallback(async () => {
    const [families, pl] = await Promise.all([api.get<Family[]>('/admin/families'), api.get<PlaceRow[]>(`/admin/places?familyId=${encodeURIComponent(id)}`)]);
    setFamily(families.find((f) => f.id === id) ?? null);
    setPlaces(pl);
  }, [id]);
  useEffect(() => {
    void load().catch(() => setFamily(null));
  }, [load]);

  const run: Run = async (fn, ok) => {
    try {
      await fn();
      toast.show(ok);
      await load();
      return true;
    } catch (e) {
      toast.show((e as Error).message);
      return false;
    }
  };
  /** То же, но панель закрывается после успеха. */
  const runClose: Run = async (fn, ok) => {
    const done = await run(fn, ok);
    if (done) setPanel(null);
    return done;
  };

  const issue = async (userId: string) => {
    setPanel(null);
    try {
      const r = await api.post<{ code: string; link: string }>(`/admin/users/${userId}/invite`);
      setCodes((c) => ({ ...c, [userId]: r }));
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

  const shell = (body: ReactNode) => (
    <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>
      <DeskNav />
      <main className="desk-main" style={{ maxWidth: 820 }}>
        {body}
      </main>
      <PanelSheet panel={panel} onClose={() => setPanel(null)} />
      {panel?.kind === 'place' && family && (
        <Sheet open onClose={() => setPanel(null)}>
          <PlaceForm geocodePath="/admin/geocode" title="Новое место" onSave={(p: PlacePayload) => runClose(() => api.post('/admin/places', { ...p, familyId: family.id }), 'Место добавлено')} />
        </Sheet>
      )}
      {panel?.kind === 'ride' && family && (
        <Sheet open onClose={() => setPanel(null)}>
          <NewTemplate families={[family]} places={places} run={runClose} fixedFamilyId={family.id} />
        </Sheet>
      )}
      {toast.node}
    </div>
  );

  if (family === undefined) return shell(<Skeleton rows={4} />);
  if (family === null)
    return shell(
      <>
        <div className="note error">Семья не найдена.</div>
        <Link to="/admin/clients" className="btn secondary">
          К списку семей
        </Link>
      </>,
    );

  const childName = (cid: string) => family.children.find((c) => c.id === cid)?.firstName ?? '';
  const driverName = (did: string | null) => (drivers.find((d) => (did ? d.id === did : d.main)) ?? drivers.find((d) => d.main))?.name;

  return shell(
    <>
      <div className="page-head">
        <Clock />
        <BackButton to="/admin/clients" label="Семьи" />
        <h1 className="page-title" style={{ flex: 1 }}>
          {family.name}
        </h1>
        <Link to={`/admin/chat?thread=${encodeURIComponent(`family:${family.id}`)}`} className="btn small secondary">
          Написать
        </Link>
        <MoreButton
          label="Действия с семьёй"
          onClick={() =>
            setPanel({
              kind: 'menu',
              title: family.name,
              actions: [
                { label: 'Переименовать', onClick: () => setPanel({ kind: 'form', title: 'Название семьи', fields: [{ key: 'name', label: 'Название', value: family.name }], save: (v) => runClose(() => api.patch(`/admin/families/${family.id}`, { name: v.name.trim() }), 'Название изменено') }) },
                {
                  label: 'Удалить семью',
                  danger: true,
                  onClick: () =>
                    setPanel({
                      kind: 'confirm',
                      title: `Удалить «${family.name}»?`,
                      text: 'Получится, только если поездок ещё не было. Взрослые потеряют вход в приложение.',
                      confirm: 'Удалить семью',
                      onConfirm: async () => {
                        const ok = await runClose(() => api.del(`/admin/families/${family.id}`), 'Семья удалена');
                        if (ok) navigate('/admin/clients');
                        return ok;
                      },
                    }),
                },
              ],
            })
          }
        />
      </div>

      <Block title="Взрослые" hint="Код входа нужен, если не получается войти через Яндекс: 3 дня, два входа.">
        {family.members.map((m) => (
          <li key={m.userId} className="fc-row">
            <span className="fc-main">
              <b>
                {m.name} <span className="fc-muted">· {m.relation}</span>
              </b>
              <small>
                {[m.phone ? formatPhone(m.phone) : null, m.email ?? 'почты нет — письма не уйдут', m.yandex ? 'Яндекс привязан' : null].filter(Boolean).join(' · ')}
              </small>
              {codes[m.userId] && (
                <span className="fc-code">
                  <b className="mono">{codes[m.userId].code}</b>
                  <button className="btn small secondary" onClick={() => copy(m.userId, codes[m.userId].code)}>
                    {copied === m.userId ? 'Скопировано' : 'Скопировать код'}
                  </button>
                  <button className="btn small secondary" onClick={() => copy(`${m.userId}l`, codes[m.userId].link)}>
                    {copied === `${m.userId}l` ? 'Скопировано' : 'Ссылка для входа'}
                  </button>
                </span>
              )}
            </span>
            <MoreButton
              label={`Действия: ${m.name}`}
              onClick={() =>
                setPanel({
                  kind: 'menu',
                  title: m.name,
                  sub: m.relation,
                  actions: [
                    { label: 'Выдать код входа', onClick: () => void issue(m.userId) },
                    { label: m.email ? 'Изменить почту' : 'Добавить почту', onClick: () => setPanel({ kind: 'form', title: 'Почта для писем', fields: [{ key: 'email', label: 'Почта', value: m.email ?? '', placeholder: 'name@yandex.ru', type: 'email' }], save: (v) => runClose(() => api.post(`/admin/users/${m.userId}/contacts`, { email: v.email.trim() }), 'Почта сохранена') }) },
                    {
                      label: 'Убрать из семьи',
                      danger: true,
                      onClick: () =>
                        setPanel({ kind: 'confirm', title: `Убрать «${m.name}»?`, text: 'Человек сразу потеряет вход в приложение этой семьи.', confirm: 'Убрать', onConfirm: () => runClose(() => api.del(`/admin/families/${family.id}/members/${m.userId}`), 'Взрослый убран') }),
                    },
                  ],
                })
              }
            />
          </li>
        ))}
      </Block>

      <Block title="Дети" empty="Детей пока нет.">
        {family.children.map((c) => (
          <li key={c.id} className="fc-row">
            <span className="fc-main">
              <b>{c.firstName}</b>
              {c.grade && <small>{c.grade}</small>}
            </span>
            <MoreButton
              label={`Действия: ${c.firstName}`}
              onClick={() =>
                setPanel({
                  kind: 'menu',
                  title: c.firstName,
                  actions: [
                    {
                      label: 'Изменить',
                      onClick: () =>
                        setPanel({
                          kind: 'form',
                          title: 'Ребёнок',
                          fields: [
                            { key: 'firstName', label: 'Имя', value: c.firstName },
                            { key: 'grade', label: 'Класс', value: c.grade ?? '', placeholder: '3 кл.' },
                          ],
                          save: (v) => runClose(() => api.patch(`/admin/children/${c.id}`, { firstName: v.firstName.trim(), grade: v.grade.trim() }), 'Данные ребёнка изменены'),
                        }),
                    },
                    { label: 'Удалить', danger: true, onClick: () => setPanel({ kind: 'confirm', title: `Удалить «${c.firstName}»?`, text: 'Если поездки уже были, удалить не получится — тогда остановите его поездки по расписанию.', confirm: 'Удалить', onConfirm: () => runClose(() => api.del(`/admin/children/${c.id}`), 'Ребёнок удалён') }) },
                  ],
                })
              }
            />
          </li>
        ))}
      </Block>

      <Block title="Места" add="Место" onAdd={() => setPanel({ kind: 'place' })} empty="Мест пока нет. Клиент может добавить их сам: «Семья» → «Мои места».">
        {places.map((p) => (
          <li key={p.id} className="fc-row">
            <span className="fc-main">
              <b>{p.name}</b>
              <small>
                {p.address}
                {p.entranceNote ? ` · ${p.entranceNote}` : ''}
              </small>
            </span>
            <MoreButton
              label={`Действия: ${p.name}`}
              onClick={() =>
                setPanel({
                  kind: 'menu',
                  title: p.name,
                  sub: p.address,
                  actions: [
                    {
                      label: 'Изменить',
                      onClick: () =>
                        setPanel({
                          kind: 'form',
                          title: 'Место',
                          fields: [
                            { key: 'name', label: 'Название', value: p.name },
                            { key: 'entranceNote', label: 'Как пройти (видит водитель)', value: p.entranceNote ?? '', placeholder: 'Вход со двора, 2 этаж' },
                          ],
                          save: (v) => runClose(() => api.patch(`/admin/places/${p.id}`, { name: v.name.trim(), entranceNote: v.entranceNote.trim() }), 'Место изменено'),
                        }),
                    },
                    { label: 'Удалить', danger: true, onClick: () => setPanel({ kind: 'confirm', title: `Удалить «${p.name}»?`, text: 'Если место используется в поездках, сначала остановите эти поездки.', confirm: 'Удалить', onConfirm: () => runClose(() => api.del(`/admin/places/${p.id}`), 'Место удалено') }) },
                  ],
                })
              }
            />
          </li>
        ))}
      </Block>

      <Block
        title="Поездки по расписанию"
        add="Поездка"
        onAdd={places.length >= 2 ? () => setPanel({ kind: 'ride' }) : undefined}
        empty={places.length >= 2 ? 'Поездок пока нет.' : 'Чтобы создать поездку, нужно два места: откуда и куда.'}
      >
        {family.templates.map((t) => (
          <li key={t.id} className="fc-row">
            <span className="fc-main">
              <b>
                {t.time} {childName(t.childId)}
              </b>
              <small>
                {t.ruleText}
                {drivers.length > 1 ? ` · ${driverName(t.driverId)}` : ''}
                {lite ? '' : ` · ${t.priceRub} ₽`}
              </small>
            </span>
            <MoreButton
              label={`Действия: поездка ${t.time}`}
              onClick={() =>
                setPanel({
                  kind: 'menu',
                  title: `${t.time} ${childName(t.childId)}`,
                  sub: t.ruleText,
                  extra:
                    drivers.length > 1 ? (
                      <div className="field">
                        <label htmlFor="fc-driver">Кто везёт</label>
                        <select
                          id="fc-driver"
                          className="input"
                          defaultValue={drivers.some((d) => d.id === t.driverId && !d.main) ? t.driverId! : ''}
                          onChange={(e) => void runClose(() => api.post(`/admin/templates/${t.id}/driver`, { driverId: e.target.value || null }), 'Водитель назначен, рейсы пересобраны')}
                        >
                          {drivers.map((d) => (
                            <option key={d.id} value={d.main ? '' : d.id}>
                              {d.name}
                              {d.car ? ` · ${d.car}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : undefined,
                  actions: [
                    {
                      label: 'Остановить поездку',
                      danger: true,
                      onClick: () =>
                        setPanel({ kind: 'confirm', title: 'Остановить поездку?', text: 'Будущие поездки по этому расписанию уберутся, прошедшие останутся в истории. Семья увидит изменения в своей неделе.', confirm: 'Остановить', onConfirm: () => runClose(() => api.del(`/admin/templates/${t.id}`), 'Поездка остановлена') }),
                    },
                  ],
                })
              }
            />
          </li>
        ))}
      </Block>
    </>,
  );
}
