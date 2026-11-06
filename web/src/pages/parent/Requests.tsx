// Мои заявки: что отправлено и что ответил диспетчер.
import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../../components/ui';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { addDays, formatDateRu, localDate, weekday, WEEKDAYS_SHORT } from '@shared/time';
import type { ChildView, ParentDay } from '@shared/api';

export interface RequestRow {
  id: string;
  familyName: string;
  children: string[];
  from: string | null;
  to: string | null;
  time: string;
  ruleText: string;
  startDate: string;
  priceRub: number;
  comment: string | null;
  status: 'new' | 'accepted' | 'declined';
  answer: string | null;
  createdAt?: string;
}

export const REQUEST_STATUS = { new: ['plan', 'на рассмотрении'], accepted: ['ok', 'принята'], declined: ['alert', 'не принята'] } as const;

export interface ChangeRow {
  id: string;
  kind: 'cancel' | 'time' | 'absence' | 'place';
  status: 'new' | 'accepted' | 'declined' | 'withdrawn';
  familyId: string;
  familyName: string;
  childName: string;
  title: string;
  summary: string;
  time: string | null;
  currentTime: string | null;
  reason: string | null;
  answer: string | null;
  createdAt?: string;
}

export const CHANGE_STATUS = {
  new: ['plan', 'ждёт ответа'],
  accepted: ['ok', 'принято'],
  declined: ['alert', 'не принято'],
  withdrawn: ['plan', 'отозвано'],
} as const;

/** Что ждёт ответа диспетчера — и недавние отказы. Принятое не показываем: план уже изменился, пришло уведомление. */
export function Waiting() {
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const load = useCallback(async () => {
    const [c, r] = await Promise.all([api.get<ChangeRow[]>('/parent/changes'), api.get<RequestRow[]>('/parent/requests')]);
    setChanges(c);
    setRequests(r);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });
  const since = Date.now() - 2 * 864e5;
  const recent = (x: { status: string; createdAt?: string }) => x.status === 'new' || (x.status === 'declined' && (!x.createdAt || Date.parse(x.createdAt) > since));
  const ch = changes.filter(recent).slice(0, 4);
  const rq = requests.filter(recent).slice(0, 3);
  if (!ch.length && !rq.length) return null;
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  return (
    <ul className="waiting" aria-label="Просьбы диспетчеру">
      {ch.map((r) => (
        <li key={r.id} className={r.status}>
          <span>
            <b>{r.status === 'new' ? 'Ждёт ответа' : 'Не принято'}:</b> {cap(r.title)} · {r.summary}
            {r.answer ? ` — ${r.answer}` : ''}
          </span>
          {r.status === 'new' && (
            <button type="button" onClick={() => void api.del(`/parent/changes/${r.id}`).then(load)}>
              отозвать
            </button>
          )}
        </li>
      ))}
      {rq.map((r) => (
        <li key={r.id} className={r.status}>
          <span>
            <b>{r.status === 'new' ? 'Заявка ждёт ответа' : 'Заявка не принята'}:</b> {r.children.join(', ')}, {r.time} · {r.from} → {r.to}
            {r.answer ? ` — ${r.answer}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

const ABSENCE_REASONS = ['Болезнь', 'Семейные обстоятельства', 'Отпуск', 'Сборы'];

/** «Ребёнка не будет»: причина и дни подряд. Поездки отменит диспетчер. */
export function AbsenceSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (msg: string, changeId?: string) => void }) {
  const [children, setChildren] = useState<ChildView[]>([]);
  const [childId, setChildId] = useState('');
  const [reason, setReason] = useState(ABSENCE_REASONS[0]);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.get<ParentDay>('/parent/day').then((d) => {
      setChildren(d.children);
      setChildId((c) => c || d.children[0]?.id || '');
    });
  }, [open]);
  const today = localDate();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  // тап задаёт начало, второй тап — конец периода; третий начинает заново
  const tap = (d: string) => {
    if (!from || to || d < from) {
      setFrom(d);
      setTo(null);
    } else setTo(d);
  };
  const end = to ?? from;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>('/parent/absence', { childId, dateFrom: from, dateTo: end, reason });
      onDone('Просьба отправлена диспетчеру', r.id);
      setFrom(null);
      setTo(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h3>Ребёнка не будет</h3>
      {children.length > 1 && (
        <div className="pick">
          {children.map((c) => (
            <button key={c.id} type="button" className={childId === c.id ? 'on' : ''} onClick={() => setChildId(c.id)}>
              {c.firstName}
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label>Причина</label>
        <div className="pick">
          {ABSENCE_REASONS.map((x) => (
            <button key={x} type="button" className={reason === x ? 'on' : ''} onClick={() => setReason(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Дни: нажмите первый и последний</label>
        <div className="absence-grid">
          {days.map((d) => {
            const on = !!from && d >= from && d <= (end ?? from);
            return (
              <button key={d} type="button" className={on ? 'on' : ''} onClick={() => tap(d)}>
                <small>{WEEKDAYS_SHORT[weekday(d) - 1]}</small>
                <b>{Number(d.slice(8))}</b>
              </button>
            );
          })}
        </div>
      </div>
      {from && <div className="note plain">{from === end ? formatDateRu(from) : `С ${formatDateRu(from)} по ${formatDateRu(end!)}`}: поездки отменятся после ответа диспетчера.</div>}
      {error && <div className="note error">{error}</div>}
      <button className="btn block" disabled={busy || !from || !childId} onClick={() => void send()}>
        Отправить диспетчеру
      </button>
      <button className="btn secondary block" onClick={onClose}>
        Закрыть
      </button>
    </Sheet>
  );
}

/** Сообщение после просьбы с кнопкой «Отменить» на 10 секунд: просьба отзывается, диспетчер её не увидит.
 *  Одна поездка на двоих детей — несколько просьб: «Отменить» отзывает все. */
export function undoable(toast: { show: (t: string, a?: { label: string; onClick: () => void }) => void }, reload: () => void) {
  return (msg: string, changeId?: string | string[]) => {
    const ids = (Array.isArray(changeId) ? changeId : [changeId]).filter((x): x is string => !!x);
    toast.show(
      msg,
      ids.length
        ? {
            label: 'Отменить',
            onClick: () =>
              void Promise.all(ids.map((id) => api.del(`/parent/changes/${id}`)))
                .then(() => toast.show(ids.length > 1 ? 'Просьбы отозваны — диспетчер их не увидит' : 'Просьба отозвана — диспетчер её не увидит'))
                .catch((e) => toast.show((e as Error).message))
                .finally(reload),
          }
        : undefined,
    );
    reload();
  };
}
