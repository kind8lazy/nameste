// Действия с поездкой: подтвердить, попросить отменить или перенести время.
// Отмену и перенос применяет диспетчер — родитель отправляет просьбу и ждёт ответа.
import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Avatar, Sheet, Tag } from '../../components/ui';
import type { RideView } from '@shared/api';
import { ESCORT_LABELS } from '@shared/domain';
import { addMinutes, formatDayRu } from '@shared/time';

const REASONS = ['Заболел', 'Заберём сами', 'Занятие отменили'];
const CHANGEABLE = ['planned', 'confirmed'];

/** Быстрый выбор: от часа раньше до двух часов позже, шаг 20 минут. */
function slots(time: string): string[] {
  return Array.from({ length: 10 }, (_, i) => addMinutes(time, (i - 3) * 20)).filter((t) => t !== time && t >= '06:00' && t <= '22:00');
}

export function RideSheet({ rides, onClose, onDone }: { rides: RideView[] | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [timeFor, setTimeFor] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!rides) return null;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(msg);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const first = rides[0];
  const canChange = (r: RideView) => CHANGEABLE.includes(r.status) && !r.pending;
  return (
    <Sheet open onClose={onClose}>
      <div className="page-sub">{formatDayRu(first.date)}</div>
      <h3>
        {first.pickupTime} · {first.from.name}
      </h3>
      <ul className="list">
        {rides.map((r) => (
          <li key={r.id} style={{ padding: '12px 14px', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar child={r.child} />
              <div style={{ flex: 1, display: 'grid' }}>
                <b>{r.child.firstName}</b>
                <small className="page-sub">
                  {r.from.name} → {r.to.name} · {ESCORT_LABELS[r.escort]}
                </small>
              </div>
              <Tag tone={r.tone}>{r.statusLabel}</Tag>
            </div>
            {r.pending && (
              <div className="note plain">
                Ждёт ответа диспетчера: {r.pending.kind === 'cancel' ? 'отменить поездку' : `забрать в ${r.pending.time}`}. Пока поездка остаётся по плану.
              </div>
            )}
            {r.status === 'planned' && !r.pending && (
              <button className="btn small secondary" disabled={busy} onClick={() => act(() => api.post(`/parent/rides/${r.id}/confirm`), 'Поездка подтверждена')}>
                Подтвердить
              </button>
            )}
            {canChange(r) && timeFor !== r.id && (
              <div className="btn-row">
                <button className="btn small secondary" disabled={busy} onClick={() => { setTimeFor(r.id); setTime(''); }}>
                  Другое время
                </button>
                <button
                  className="btn small danger"
                  disabled={busy}
                  onClick={() => act(() => api.post(`/parent/rides/${r.id}/cancel`, { reason }), 'Просьба отменить отправлена диспетчеру')}
                >
                  Попросить отменить
                </button>
              </div>
            )}
            {timeFor === r.id && (
              <div style={{ display: 'grid', gap: 8 }}>
                <small className="page-sub">Во сколько забрать {formatDayRu(r.date)}? Сейчас: {r.pickupTime}</small>
                <div className="pick">
                  {slots(r.pickupTime).map((t) => (
                    <button key={t} type="button" className={time === t ? 'on' : ''} onClick={() => setTime(t)}>
                      {t}
                    </button>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor={`t-${r.id}`}>Другое время</label>
                  <input id={`t-${r.id}`} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
                <div className="btn-row">
                  <button className="btn small secondary" onClick={() => setTimeFor(null)}>
                    Назад
                  </button>
                  <button
                    className="btn small"
                    disabled={busy || !time || time === r.pickupTime}
                    onClick={() => act(() => api.post(`/parent/rides/${r.id}/time`, { time }), `Просьба забрать в ${time} отправлена диспетчеру`)}
                  >
                    Попросить
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {rides.some(canChange) && !timeFor && (
        <div className="field">
          <label>Причина отмены</label>
          <div className="pick">
            {REASONS.map((x) => (
              <button key={x} className={reason === x ? 'on' : ''} onClick={() => setReason(x)} type="button">
                {x}
              </button>
            ))}
          </div>
        </div>
      )}
      {rides.some(canChange) && <small className="page-sub">Изменения применяет диспетчер: он проверит, что водитель успевает. Ответ придёт уведомлением.</small>}
      {error && <div className="note error">{error}</div>}
      <button className="btn secondary block" onClick={onClose}>
        Закрыть
      </button>
    </Sheet>
  );
}
