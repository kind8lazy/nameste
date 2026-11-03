// Входящие диспетчера: просьбы родителей изменить план и заявки на новые поездки — в одном месте.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/ui';
import { Clock } from '../../components/Clock';
import { DeskNav } from './DeskNav';
import { REQUEST_STATUS, CHANGE_STATUS, type RequestRow, type ChangeRow } from '../parent/Requests';

export function useInbox() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const load = useCallback(async () => {
    const [r, c] = await Promise.all([api.get<RequestRow[]>('/admin/requests'), api.get<ChangeRow[]>('/admin/changes')]);
    setRequests(r);
    setChanges(c);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });
  return { requests, changes, load };
}

/** Только то, что ждёт решения. Пусто — ничего не показываем. */
export function PendingList({ onDone }: { onDone: (msg: string) => void }) {
  const { requests, changes, load } = useInbox();
  const done = (m: string) => {
    onDone(m);
    void load();
  };
  const newChanges = changes.filter((c) => c.status === 'new');
  const newRequests = requests.filter((r) => r.status === 'new');
  if (!newChanges.length && !newRequests.length) return null;
  return (
    <>
      {newChanges.map((c) => (
        <ChangeCard key={c.id} c={c} onDone={done} />
      ))}
      {newRequests.map((r) => (
        <RequestCard key={r.id} r={r} onDone={done} />
      ))}
    </>
  );
}

export function Inbox() {
  const toast = useToast();
  const { requests, changes, load } = useInbox();
  const done = (m: string) => {
    toast.show(m);
    void load();
  };
  const newChanges = changes.filter((c) => c.status === 'new');
  const newRequests = requests.filter((r) => r.status === 'new');
  const history = [
    ...changes.filter((c) => c.status === 'accepted' || c.status === 'declined').map((c) => ({ at: String(c.createdAt ?? ''), node: <ChangeCard key={c.id} c={c} onDone={done} /> })),
    ...requests.filter((r) => r.status !== 'new').map((r) => ({ at: String(r.createdAt ?? ''), node: <RequestCard key={r.id} r={r} onDone={done} /> })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);
  return (
    <div className="desk desk-2">
      <DeskNav />
      <main className="desk-main" style={{ maxWidth: 760 }}>
        <div className="page-head">
          <Clock />
          <h1 className="page-title">Входящие</h1>
        </div>
        <h3>Ждут решения</h3>
        {!newChanges.length && !newRequests.length && <div className="card empty">Всё решено — новых просьб и заявок нет</div>}
        {newChanges.map((c) => (
          <ChangeCard key={c.id} c={c} onDone={done} />
        ))}
        {newRequests.map((r) => (
          <RequestCard key={r.id} r={r} onDone={done} />
        ))}
        {history.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Решённые</h3>
            {history.map((h) => h.node)}
          </>
        )}
      </main>
      {toast.node}
    </div>
  );
}

/** Заявка на новую поездку: принять (поездки появятся в неделе семьи) или ответить, что окна нет. */
export function RequestCard({ r, onDone }: { r: RequestRow; onDone: (msg: string) => void }) {
  const lite = !!useAuth().me?.lite;
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 6, boxShadow: r.status === 'new' ? 'inset 3px 0 0 #B8964F' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>
          Новая поездка: {r.time} {r.children.join(', ')}
        </b>
        {r.status !== 'new' && <span className={`tag tone-${REQUEST_STATUS[r.status][0]}`}>{REQUEST_STATUS[r.status][1]}</span>}
      </div>
      <small className="page-sub">
        {r.familyName} · {r.from} → {r.to} · {r.ruleText}
        {lite ? '' : ` · ${r.priceRub.toLocaleString('ru-RU')} ₽`}
      </small>
      {r.comment && <small>«{r.comment}»</small>}
      {r.answer && <small>Ответ: {r.answer}</small>}
      {r.status === 'new' && (
        <div className="btn-row">
          <button
            className="btn small"
            onClick={async () => {
              try {
                await api.post(`/admin/requests/${r.id}/accept`);
                onDone('Принято: поездки добавлены в неделю семьи');
              } catch (e) {
                onDone(e instanceof ApiError ? e.message : 'Не получилось');
              }
            }}
          >
            Принять
          </button>
          <button
            className="btn small secondary"
            onClick={async () => {
              await api.post(`/admin/requests/${r.id}/decline`, { answer: 'На это время машина занята. Напишем, как появится окно.' });
              onDone('Семья получила ответ');
            }}
          >
            Нет окна
          </button>
        </div>
      )}
    </div>
  );
}

/** Просьба родителя: принять как есть, принять со своим временем или отказать с причиной. */
export function ChangeCard({ c, onDone }: { c: ChangeRow; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<'time' | 'decline' | null>(null);
  const [time, setTime] = useState(c.time ?? '');
  const [answer, setAnswer] = useState('В это время водитель занят.');
  const call = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      onDone(ok);
    } catch (e) {
      onDone(e instanceof ApiError ? e.message : 'Не получилось');
    }
  };
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 6, boxShadow: c.status === 'new' ? 'inset 3px 0 0 #B8964F' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>{c.title[0].toUpperCase() + c.title.slice(1)}</b>
        {c.status !== 'new' && <span className={`tag tone-${CHANGE_STATUS[c.status][0]}`}>{CHANGE_STATUS[c.status][1]}</span>}
      </div>
      <small className="page-sub">
        {c.familyName} · {c.summary}
        {c.reason ? ` · ${c.reason}` : ''}
      </small>
      {c.answer && <small>Ответ: {c.answer}</small>}
      {c.status === 'new' && !mode && (
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => void call(() => api.post(`/admin/changes/${c.id}/accept`), 'Принято, рейс пересобран, семья получила ответ')}>
            Принять
          </button>
          {c.kind === 'time' && (
            <button className="btn small secondary" onClick={() => setMode('time')}>
              Другое время
            </button>
          )}
          <button className="btn small secondary" onClick={() => setMode('decline')}>
            Отказать
          </button>
        </div>
      )}
      {mode === 'time' && (
        <div className="btn-row" style={{ alignItems: 'end' }}>
          <div className="field">
            <label htmlFor={`ct-${c.id}`}>Могу забрать в</label>
            <input id={`ct-${c.id}`} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <button className="btn small" disabled={!time} onClick={() => void call(() => api.post(`/admin/changes/${c.id}/accept`, { time }), `Принято на ${time}, семья получила ответ`)}>
            Принять на {time || '…'}
          </button>
          <button className="btn small secondary" onClick={() => setMode(null)}>
            Назад
          </button>
        </div>
      )}
      {mode === 'decline' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input className="input" aria-label="Причина отказа" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="btn-row">
            <button className="btn small" disabled={answer.trim().length < 3} onClick={() => void call(() => api.post(`/admin/changes/${c.id}/decline`, { answer }), 'Семья получила ответ')}>
              Отправить отказ
            </button>
            <button className="btn small secondary" onClick={() => setMode(null)}>
              Назад
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
