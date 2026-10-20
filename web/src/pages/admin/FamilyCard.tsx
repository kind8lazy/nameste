// Карточка клиента: взрослые и коды входа, дети, места, поездки. Диспетчер заходит сюда из списка «Клиенты».
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { PlaceForm, type PlacePayload } from '../../components/PlaceForm';
import { MemberRow, NewTemplate, type Family, type Place, type Run } from './Clients';

interface PlaceRow extends Place {
  familyId: string | null;
  entranceNote: string | null;
}

export function FamilyCard() {
  const { id = '' } = useParams();
  const lite = !!useAuth().me?.lite;
  const [family, setFamily] = useState<Family | null | undefined>(undefined);
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [codes, setCodes] = useState<Record<string, { code: string; link: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);
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

  const issue = async (userId: string) => {
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

  const nav = (
    <nav className="desk-nav">
      <div className="wordmark">
        НА<i />МЕСТЕ
      </div>
      <Link to="/admin">Диспетчерская</Link>
      <Link to="/admin/clients" className="active">
        Клиенты
      </Link>
      <Link to="/admin/chat">Сообщения</Link>
    </nav>
  );

  if (family === undefined) return <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>{nav}<main className="desk-main"><div className="empty">Загрузка…</div></main></div>;
  if (family === null)
    return (
      <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>
        {nav}
        <main className="desk-main">
          <div className="note error">Семья не найдена.</div>
          <Link to="/admin/clients" className="btn secondary">
            ‹ К списку клиентов
          </Link>
        </main>
      </div>
    );

  return (
    <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>
      {nav}
      <main className="desk-main" style={{ maxWidth: 980 }}>
        <div className="page-head">
          <div style={{ display: 'grid', gap: 4 }}>
            <Link to="/admin/clients" className="page-sub">
              ‹ Клиенты
            </Link>
            <h1 className="page-title">{family.name}</h1>
          </div>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Link to={`/admin/chat?thread=${encodeURIComponent(`family:${family.id}`)}`} className="btn small">
              Написать
            </Link>
            <button
              className="btn small secondary"
              onClick={() => {
                const n = window.prompt('Название семьи', family.name);
                if (n && n.trim() !== family.name) void run(() => api.patch(`/admin/families/${family.id}`, { name: n.trim() }), 'Название изменено');
              }}
            >
              Переименовать
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (window.confirm(`Удалить семью «${family.name}»? Это возможно, только если поездок ещё не было.`)) void run(() => api.del(`/admin/families/${family.id}`), 'Семья удалена').then((ok) => ok && (window.location.href = '/admin/clients'));
              }}
            >
              Удалить семью
            </button>
          </span>
        </div>

        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Взрослые и вход в приложение</h3>
          <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            {family.members.map((m) => (
              <div key={m.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <MemberRow m={m} run={run} />
                {codes[m.userId] ? (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b className="mono" style={{ fontSize: 20, letterSpacing: '0.12em', userSelect: 'all' }}>
                      {codes[m.userId].code}
                    </b>
                    <button className="btn small secondary" onClick={() => copy(m.userId, codes[m.userId].code)}>
                      {copied === m.userId ? 'Скопировано' : 'Скопировать код'}
                    </button>
                    <button className="btn small secondary" onClick={() => copy(`${m.userId}l`, codes[m.userId].link)}>
                      {copied === `${m.userId}l` ? 'Скопировано' : 'Скопировать ссылку'}
                    </button>
                  </span>
                ) : (
                  <button className="btn small" onClick={() => issue(m.userId)}>
                    Выдать код входа
                  </button>
                )}
                <button
                  className="btn small danger"
                  onClick={() => window.confirm(`Убрать «${m.name}» из семьи? Он сразу потеряет вход в приложение.`) && void run(() => api.del(`/admin/families/${family.id}/members/${m.userId}`), 'Взрослый убран')}
                >
                  Убрать
                </button>
              </div>
            ))}
            <small className="page-sub">Код действует 3 дня и подходит для двух входов. Человек вводит его на странице входа, если Яндекс не получается.</small>
          </div>
        </section>

        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Дети</h3>
          <div className="card" style={{ padding: 14 }}>
            {family.children.length
              ? family.children.map((c) => (
                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{[c.firstName, c.grade].filter(Boolean).join(', ')}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn small secondary"
                        onClick={() => {
                          const n = window.prompt('Имя ребёнка', c.firstName);
                          if (!n) return;
                          const g = window.prompt('Класс (например, 3 кл.)', c.grade ?? '') ?? c.grade ?? '';
                          void run(() => api.patch(`/admin/children/${c.id}`, { firstName: n.trim(), grade: g.trim() }), 'Данные ребёнка изменены');
                        }}
                      >
                        Изменить
                      </button>
                      <button className="btn small danger" onClick={() => window.confirm(`Удалить ребёнка «${c.firstName}»?`) && void run(() => api.del(`/admin/children/${c.id}`), 'Ребёнок удалён')}>
                        Удалить
                      </button>
                    </span>
                  </div>
                ))
              : '—'}
          </div>
        </section>

        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Места клиента</h3>
          <ul className="list">
            {places.map((p) => (
              <li key={p.id} style={{ padding: '12px 14px', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ display: 'grid' }}>
                  <b>{p.name}</b>
                  <small className="page-sub">
                    {p.address}
                    {p.entranceNote ? ` · ${p.entranceNote}` : ''}
                  </small>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn small secondary"
                    onClick={() => {
                      const n = window.prompt('Название места', p.name);
                      if (!n) return;
                      const note = window.prompt('Как пройти (видит водитель)', p.entranceNote ?? '') ?? p.entranceNote ?? '';
                      void run(() => api.patch(`/admin/places/${p.id}`, { name: n.trim(), entranceNote: note.trim() }), 'Место изменено');
                    }}
                  >
                    Изменить
                  </button>
                  <button className="btn small danger" onClick={() => window.confirm(`Удалить место «${p.name}»?`) && void run(() => api.del(`/admin/places/${p.id}`), 'Место удалено')}>
                    Удалить
                  </button>
                </span>
              </li>
            ))}
            {!places.length && <li className="empty">Мест пока нет. Добавьте адреса ниже или клиент добавит их сам в приложении («Семья» → «Мои места»).</li>}
          </ul>
          <PlaceForm
            geocodePath="/admin/geocode"
            title="Добавить место клиенту"
            onSave={(p: PlacePayload) => run(() => api.post('/admin/places', { ...p, familyId: family.id }), 'Место добавлено')}
          />
        </section>

        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Поездки по расписанию</h3>
          <div className="card" style={{ padding: 14 }}>
            {family.templates.length
              ? family.templates.map((t) => (
                  <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>
                      {t.time} {family.children.find((c) => c.id === t.childId)?.firstName} · {t.ruleText}
                      {lite ? '' : ` · ${t.priceRub} ₽`}
                    </span>
                    <button
                      className="btn small danger"
                      onClick={() => window.confirm('Остановить эту поездку по расписанию? Будущие поездки уберутся, прошлые останутся в истории.') && void run(() => api.del(`/admin/templates/${t.id}`), 'Поездка остановлена')}
                    >
                      Остановить
                    </button>
                  </div>
                ))
              : 'Поездок пока нет.'}
          </div>
          {places.length >= 2 ? (
            <NewTemplate families={[family]} places={places} run={run} fixedFamilyId={family.id} />
          ) : (
            <div className="note">Чтобы создать поездку, нужно минимум два места: откуда и куда. Добавьте их выше.</div>
          )}
        </section>
      </main>
      {toast.node}
    </div>
  );
}
