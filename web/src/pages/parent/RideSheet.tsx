// Поездка: одно главное действие — «Всё в силе». Перенос и отмена — отдельными шагами:
// причину отмены выбирает человек, заранее ничего не выбрано. Отмену и перенос применяет диспетчер.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Avatar, Sheet, Tag } from '../../components/ui';
import type { RideView } from '@shared/api';
import { addMinutes, formatDayRu } from '@shared/time';

const REASONS = ['Заболел', 'Заберём сами', 'Занятие отменили', 'Другое'];
const CHANGEABLE = ['planned', 'confirmed'];
const ESCORT_SHORT = { to_door: 'до кабинета', to_entrance: 'до входа' } as const;
const STEP_MIN = 10;

type Step = 'main' | 'cancel' | 'time';

export function RideSheet({ rides, onClose, onDone }: { rides: RideView[] | null; onClose: () => void; onDone: (msg: string, changeIds?: string[]) => void }) {
  const [step, setStep] = useState<Step>('main');
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [time, setTime] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeable = (rides ?? []).filter((r) => CHANGEABLE.includes(r.status) && !r.pending);
  // новая поездка в панели — начинаем с первого шага и без выбранной причины
  const key = rides?.map((r) => r.id).join(',');
  useEffect(() => {
    setStep('main');
    setReason(null);
    setOther('');
    setError(null);
    setWho(changeable.map((r) => r.id));
    setTime(rides?.[0]?.pickupTime ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!rides) return null;

  const first = rides[0];
  const toPlan = changeable.filter((r) => r.status === 'planned');
  const chosen = changeable.filter((r) => who.includes(r.id));
  const many = changeable.length > 1;

  const send = async (calls: (() => Promise<unknown>)[], msg: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = (await Promise.all(calls.map((c) => c()))) as ({ id?: string; kind?: string } | undefined)[];
      // просьбы (отмена, перенос) можно отозвать в первые 10 секунд
      onDone(msg, res.filter((r) => r?.kind).map((r) => r!.id!));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };
  const back = () => {
    setStep('main');
    setError(null);
  };
  const shift = (d: number) => {
    const t = addMinutes(time, d * STEP_MIN);
    if (t >= '06:00' && t <= '22:00') setTime(t);
  };

  // Для кого — только если в поездке несколько детей
  const whoPicker = many && (
    <div className="pick" role="group" aria-label="Для кого">
      {changeable.map((r) => (
        <button key={r.id} type="button" aria-pressed={who.includes(r.id)} className={who.includes(r.id) ? 'on' : ''} onClick={() => setWho((w) => (w.includes(r.id) ? w.filter((x) => x !== r.id) : [...w, r.id]))}>
          {r.child.firstName}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet open onClose={onClose}>
      {step === 'main' && (
        <>
          <div className="page-sub">
            {formatDayRu(first.date)} · {first.pickupTime}
          </div>
          {rides.map((r) => (
            <div key={r.id} className="ride-head">
              <Avatar child={r.child} />
              <span className="who">
                <b>{r.child.firstName}</b>
                <small>
                  {r.from.name} → {r.to.name}
                </small>
              </span>
              {/* метка — только у особого статуса: «в плане» не показываем */}
              {r.status !== 'planned' && <Tag tone={r.tone}>{r.statusLabel}</Tag>}
            </div>
          ))}
          <dl className="kv">
            <div>
              <dt>Забрать</dt>
              <dd>{first.from.entranceNote || first.from.name}</dd>
            </div>
            <div>
              <dt>Отвезти</dt>
              <dd>{ESCORT_SHORT[first.escort]}</dd>
            </div>
            {first.driver && (
              <div>
                <dt>Водитель</dt>
                <dd>{[first.driver.name, first.driver.vehicle].filter(Boolean).join(' · ')}</dd>
              </div>
            )}
          </dl>
          {rides.map(
            (r) =>
              r.pending && (
                <div key={r.id} className="note plain">
                  {many ? `${r.child.firstName}: ` : ''}ждёт ответа — {r.pending.kind === 'cancel' ? 'отменить' : `забрать в ${r.pending.time}`}
                </div>
              ),
          )}
          {error && <div className="note error">{error}</div>}
          {toPlan.length > 0 && (
            <button className="btn block" disabled={busy} onClick={() => void send(toPlan.map((r) => () => api.post(`/parent/rides/${r.id}/confirm`)), 'Поездка подтверждена')}>
              Всё в силе
            </button>
          )}
          {changeable.length > 0 && (
            <>
              <button className={`btn block ${toPlan.length ? 'secondary' : ''}`} disabled={busy} onClick={() => setStep('time')}>
                Другое время
              </button>
              <button className="text-danger" disabled={busy} onClick={() => setStep('cancel')}>
                Отменить поездку
              </button>
            </>
          )}
        </>
      )}

      {step === 'cancel' && (
        <>
          <div className="page-sub">
            {many ? 'Поездка' : first.child.firstName} · {formatDayRu(first.date)}, {first.pickupTime}
          </div>
          <h3>Почему отменяем?</h3>
          {whoPicker}
          <div className="pick" role="group" aria-label="Причина">
            {REASONS.map((x) => (
              <button key={x} type="button" aria-pressed={reason === x} className={reason === x ? 'on' : ''} onClick={() => setReason(x)}>
                {x}
              </button>
            ))}
          </div>
          {reason === 'Другое' && (
            <div className="field">
              <label htmlFor="rs-other">Что случилось</label>
              <input id="rs-other" className="input" value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} />
            </div>
          )}
          {error && <div className="note error">{error}</div>}
          <button
            className="btn block"
            disabled={busy || !reason || !chosen.length}
            onClick={() => {
              const why = reason === 'Другое' ? other.trim() || 'Другое' : reason!;
              void send(
                chosen.map((r) => () => api.post(`/parent/rides/${r.id}/cancel`, { reason: why })),
                'Просьба отменить отправлена диспетчеру',
              );
            }}
          >
            {reason ? 'Попросить отменить' : 'Выберите причину'}
          </button>
          <small className="page-sub center">Ответ придёт уведомлением</small>
          <button className="text-link" onClick={back}>
            Назад
          </button>
        </>
      )}

      {step === 'time' && (
        <>
          <div className="page-sub">
            {many ? 'Поездка' : first.child.firstName} · {formatDayRu(first.date)} · {first.from.name} → {first.to.name}
          </div>
          <h3>Другое время</h3>
          {whoPicker}
          <div className="stepper">
            <button type="button" aria-label={`На ${STEP_MIN} минут раньше`} onClick={() => shift(-1)}>
              −
            </button>
            <span>
              <b>{time}</b>
              <small>было {first.pickupTime}</small>
            </span>
            <button type="button" aria-label={`На ${STEP_MIN} минут позже`} onClick={() => shift(1)}>
              +
            </button>
          </div>
          {error && <div className="note error">{error}</div>}
          <button
            className="btn block"
            disabled={busy || time === first.pickupTime || !chosen.length}
            onClick={() => void send(chosen.map((r) => () => api.post(`/parent/rides/${r.id}/time`, { time })), `Просьба забрать в ${time} отправлена диспетчеру`)}
          >
            {time === first.pickupTime ? 'Выберите время' : `Попросить ${time}`}
          </button>
          <button className="text-link" onClick={back}>
            Назад
          </button>
        </>
      )}
    </Sheet>
  );
}
