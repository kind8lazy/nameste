// Сообщения внутри приложения: переписка и список чатов. Работает у родителя, водителя и диспетчера.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useStream } from '../lib/stream';
import type { ChatMessage, ChatThread } from '@shared/api';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

/** Число непрочитанных сообщений для значка у вкладки. Обновляется само. */
export function useUnread(): number {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    api.get<{ count: number }>('/chat/unread').then((r) => setN(r.count)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('na-chat', load);
    return () => window.removeEventListener('na-chat', load);
  }, [load]);
  useStream({ chat: load, refresh: load });
  return n;
}

export function Badge({ n }: { n: number }) {
  return n > 0 ? <span className="badge" aria-label={`Непрочитанных: ${n}`}>{n > 99 ? '99+' : n}</span> : null;
}

export function ChatPane({ thread, title, onBack }: { thread: string; title: string; onBack?: () => void }) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setMsgs(await api.get<ChatMessage[]>(`/chat/messages?thread=${encodeURIComponent(thread)}`));
      await api.post('/chat/read', { thread });
      window.dispatchEvent(new Event('na-chat'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [thread]);

  useEffect(() => {
    setMsgs(null);
    setError(null);
    void load();
  }, [load]);
  useStream({ chat: (d) => (d as { thread?: string })?.thread === thread && void load(), refresh: () => void load() });

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [msgs?.length]);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const m = await api.post<ChatMessage>('/chat/messages', { thread, body: text });
      setMsgs((cur) => [...(cur ?? []), m]);
      setText('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat">
      <header className="chat-head">
        {onBack && (
          <button className="btn small secondary" onClick={onBack} aria-label="К списку чатов">
            ‹
          </button>
        )}
        <b>{title}</b>
      </header>
      <div className="chat-list" ref={list} aria-live="polite">
        {msgs === null && !error && <div className="empty">Загрузка…</div>}
        {msgs?.length === 0 && <div className="empty">Сообщений пока нет. Напишите первым.</div>}
        {msgs?.map((m, i) => {
          const newDay = i === 0 || dayLabel(msgs[i - 1].createdAt) !== dayLabel(m.createdAt);
          const showName = !m.mine && (i === 0 || msgs[i - 1].authorId !== m.authorId || newDay);
          return (
            <div key={m.id}>
              {newDay && <div className="chat-day">{dayLabel(m.createdAt)}</div>}
              {showName && (
                <div className="chat-name">
                  {m.authorName} · {m.authorRole}
                </div>
              )}
              <div className={`bubble${m.mine ? ' mine' : ''}`}>
                <span className="bubble-text">{m.body}</span>
                <time>{hhmm(m.createdAt)}</time>
              </div>
            </div>
          );
        })}
      </div>
      {error && <div className="note error">{error}</div>}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="input"
          rows={1}
          maxLength={2000}
          placeholder="Сообщение"
          aria-label="Сообщение"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn" disabled={busy || !text.trim()}>
          Отправить
        </button>
      </form>
    </section>
  );
}

/** Список чатов и переписка: у сотрудников — все семьи и команда, у родителя — один чат. */
export function ChatBrowser({ initial }: { initial?: string | null }) {
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<ChatThread[]>('/chat/threads').then(setThreads).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('na-chat', load);
    return () => window.removeEventListener('na-chat', load);
  }, [load]);
  useStream({ chat: load, refresh: load });

  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches;
  useEffect(() => {
    if (!selected && wide && threads?.length) setSelected(threads[0].id);
  }, [threads, selected, wide]);

  if (error) return <div className="note error">{error}</div>;
  if (!threads) return <div className="empty">Загрузка…</div>;
  if (!threads.length) return <div className="card empty">Чат появится, когда диспетчер привяжет вашу семью.</div>;
  const current = threads.find((t) => t.id === selected);

  const listEl = (
    <ul className="list chat-threads">
      {threads.map((t) => (
        <li key={t.id}>
          <button className={`row${t.id === selected ? ' active' : ''}`} onClick={() => setSelected(t.id)}>
            <span className="main">
              <b>{t.title}</b>
              <small>{t.last ? `${t.last.authorName}: ${t.last.body}`.slice(0, 70) : 'Сообщений нет'}</small>
            </span>
            <Badge n={t.unread} />
          </button>
        </li>
      ))}
    </ul>
  );

  if (threads.length === 1 && !threads[0].id.startsWith('team')) {
    return <ChatPane thread={threads[0].id} title={threads[0].title} />;
  }
  return (
    <div className={`chat-browser${current ? ' has-current' : ''}`}>
      <div className="chat-side">{listEl}</div>
      <div className="chat-main">{current ? <ChatPane key={current.id} thread={current.id} title={current.title} onBack={() => setSelected(null)} /> : <div className="empty">Выберите чат</div>}</div>
    </div>
  );
}
