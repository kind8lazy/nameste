// Действия с поездкой: подтвердить или отменить (с причиной).
import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Avatar, Sheet, Tag } from '../../components/ui';
import type { RideView } from '@shared/api';
import { ESCORT_LABELS } from '@shared/domain';
import { formatDayRu } from '@shared/time';

const REASONS = ['Заболел', 'Заберём сами', 'Занятие отменили'];
const CANCELLABLE = ['planned', 'confirmed', 'driver_en_route', 'driver_arrived'];

export function RideSheet({ rides, onClose, onDone }: { rides: RideView[] | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState<string>(REASONS[0]);
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
            {r.status === 'planned' && (
              <button className="btn small secondary" disabled={busy} onClick={() => act(() => api.post(`/parent/rides/${r.id}/confirm`), 'Поездка подтверждена')}>
                Подтвердить
              </button>
            )}
            {CANCELLABLE.includes(r.status) && (
              <button
                className="btn small danger"
                disabled={busy}
                onClick={() => act(() => api.post(`/parent/rides/${r.id}/cancel`, { reason }), `Поездка ${r.child.firstName} отменена`)}
              >
                Отменить для {r.child.firstName}
              </button>
            )}
          </li>
        ))}
      </ul>
      {rides.some((r) => CANCELLABLE.includes(r.status)) && (
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
      {error && <div className="note error">{error}</div>}
      <button className="btn secondary block" onClick={onClose}>
        Закрыть
      </button>
    </Sheet>
  );
}
