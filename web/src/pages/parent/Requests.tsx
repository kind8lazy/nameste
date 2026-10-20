// Мои заявки: что отправлено и что ответил диспетчер.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { Tag } from '../../components/ui';
import { formatDateRu } from '@shared/time';

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
