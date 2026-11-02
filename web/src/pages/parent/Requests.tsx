// Мои заявки: что отправлено и что ответил диспетчер.
import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../../components/ui';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { Tag } from '../../components/ui';
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
}

export const REQUEST_STATUS = { new: ['plan', 'на рассмотрении'], accepted: ['ok', 'принята'], declined: ['alert', 'не принята'] } as const;

export function MyRequests() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const load = useCallback(async () => setRows(await api.get<RequestRow[]>('/parent/requests')), []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });
  if (!rows.length) return null;
  return (
    <>
      <div className="section-label">Мои заявки</div>
      <ul className="list">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id} style={{ padding: '11px 14px', display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>
                {r.time} {r.children.join(', ')}
              </b>
              <Tag tone={REQUEST_STATUS[r.status][0]}>{REQUEST_STATUS[r.status][1]}</Tag>
            </div>
            <small className="page-sub">
              {r.from} → {r.to} · {r.ruleText}, с {formatDateRu(r.startDate)}
            </small>
            {r.answer && <small>Ответ: {r.answer}</small>}
          </li>
        ))}
      </ul>
    </>
  );
}

export interface ChangeRow {
  id: string;
  kind: 'cancel' | 'time' | 'absence';
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
}

export const CHANGE_STATUS = {
  new: ['plan', 'ждёт ответа'],
  accepted: ['ok', 'принято'],
  declined: ['alert', 'не принято'],
  withdrawn: ['plan', 'отозвано'],
} as const;

/** Мои просьбы изменить план и ответы диспетчера. */
export function MyChanges() {
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const load = useCallback(async () => setRows(await api.get<ChangeRow[]>('/parent/changes')), []);
  useEffect(() => {
    void load();
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });
  const shown = rows.filter((r) => r.status !== 'withdrawn').slice(0, 5);
  if (!shown.length) return null;
  return (
    <>
      <div className="section-label">Просьбы диспетчеру</div>
      <ul className="list">
        {shown.map((r) => (
          <li key={r.id} style={{ padding: '11px 14px', display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>{r.title[0].toUpperCase() + r.title.slice(1)}</b>
              <Tag tone={CHANGE_STATUS[r.status][0]}>{CHANGE_STATUS[r.status][1]}</Tag>
            </div>
            <small className="page-sub">
              {r.summary}
              {r.reason ? ` · ${r.reason}` : ''}
            </small>
            {r.answer && <small>Ответ: {r.answer}</small>}
            {r.status === 'new' && (
              <button className="btn small secondary" style={{ justifySelf: 'start' }} onClick={() => void api.del(`/parent/changes/${r.id}`).then(load)}>
                Отозвать
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

const ABSENCE_REASONS = ['Болезнь', 'Семейные обстоятельства', 'Отпуск', 'Сборы'];

/** «Ребёнка не будет»: причина и дни подряд. Поездки отменит диспетчер. */
export function AbsenceSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
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
      await api.post('/parent/absence', { childId, dateFrom: from, dateTo: end, reason });
      onDone('Просьба отправлена диспетчеру. Пока он не ответил, поездки остаются в плане.');
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
      {from && <div className="note plain">{from === end ? formatDateRu(from) : `С ${formatDateRu(from)} по ${formatDateRu(end!)}`}: все поездки отменятся, когда диспетчер подтвердит.</div>}
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
