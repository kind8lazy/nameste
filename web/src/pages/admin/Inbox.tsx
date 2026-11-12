// Входящие диспетчера: просьбы родителей изменить план и заявки на новые поездки — в одном месте.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/ui';
import { Clock } from '../../components/Clock';
import { DeskNav } from './DeskNav';
import { Link } from 'react-router-dom';
import { useUnread } from '../../components/Chat';
import { plural } from '@shared/ru';
import { REQUEST_STATUS, CHANGE_STATUS, type RequestRow, type ChangeRow } from '../parent/Requests';

export function useInbox() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const load = useCallback(async () => {
    const [r, c, l] = await Promise.all([api.get<RequestRow[]>('/admin/requests'), api.get<ChangeRow[]>('/admin/changes'), api.get<LeadRow[]>('/admin/leads').catch(() => [] as LeadRow[])]);
    setRequests(r);
    setChanges(c);
    setLeads(l);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });
  return { requests, changes, leads, load };
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
  const { requests, changes, leads, load } = useInbox();
  const unread = useUnread();
  const done = (m: string) => {
    toast.show(m);
    void load();
  };
  const newChanges = changes.filter((c) => c.status === 'new');
  const newRequests = requests.filter((r) => r.status === 'new');
  const newLeads = leads.filter((l) => l.status === 'new');
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
          <span className="page-sub">{newChanges.length + newRequests.length + newLeads.length ? `${newChanges.length + newRequests.length + newLeads.length} ${plural(newChanges.length + newRequests.length + newLeads.length, ['ждёт', 'ждут', 'ждут'])} ответа` : 'ничего не ждёт'}</span>
        </div>
        {unread > 0 && (
          <Link to="/admin/chat" className="inbox-msgs">
            <b>
              {unread} {plural(unread, ['новое сообщение', 'новых сообщения', 'новых сообщений'])}
            </b>
            <span>›</span>
          </Link>
        )}
        {!newChanges.length && !newRequests.length && !newLeads.length && <div className="card empty">Всё решено. Новое появится здесь.</div>}
        {newLeads.map((l) => (
          <LeadCard key={l.id} l={l} onDone={done} />
        ))}
        {newChanges.map((c) => (
          <ChangeCard key={c.id} c={c} onDone={done} />
        ))}
        {newRequests.map((r) => (
          <RequestCard key={r.id} r={r} onDone={done} />
        ))}
        {history.length > 0 && (
          <details className="inbox-history">
            <summary>Решённые · {history.length}</summary>
            {history.map((h) => h.node)}
          </details>
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

export interface LeadRow {
  id: string;
  name: string;
  phone: string;
  phoneRaw: string;
  tgUsername: string | null;
  children: string;
  fromText: string;
  toText: string;
  schedule: string;
  comment: string | null;
  status: 'new' | 'done' | 'declined';
  note: string | null;
  createdAt: string;
}

/** Заявка новой семьи из Телеграм-бота: позвонить или написать, затем отметить «связались» или «отказ». */
export function LeadCard({ l, onDone }: { l: LeadRow; onDone: (msg: string) => void }) {
  const decide = async (status: 'done' | 'declined') => {
    try {
      await api.post(`/admin/leads/${l.id}`, { status });
      onDone(status === 'done' ? 'Отмечено: связались' : 'Заявка закрыта');
    } catch (e) {
      onDone(e instanceof ApiError ? e.message : 'Не получилось');
    }
  };
  return (
    <div className="card lead-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>Новая семья: {l.name}</b>
        <span className="tag tone-gold">Телеграм</span>
      </div>
      <small className="page-sub">
        {l.children} · {l.fromText} → {l.toText} · {l.schedule}
        {l.comment ? ` · ${l.comment}` : ''}
      </small>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <a className="btn small" href={`tel:+${l.phoneRaw}`}>
          Позвонить {l.phone}
        </a>
        {l.tgUsername && (
          <a className="btn small secondary" href={`https://t.me/${l.tgUsername}`} target="_blank" rel="noreferrer">
            Написать @{l.tgUsername}
          </a>
        )}
      </div>
      <div className="btn-row">
        <button className="btn small secondary" onClick={() => void decide('done')}>
          Связались
        </button>
        <button className="btn small secondary" onClick={() => void decide('declined')}>
          Отказ
        </button>
      </div>
    </div>
  );
}
