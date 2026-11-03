// Общие детали спокойных экранов диспетчера: блок со списком, кнопка «⋯» и нижняя панель
// (меню действий, короткая форма или подтверждение с последствиями).
import { useEffect, useState, type ReactNode } from 'react';
import { Sheet } from '../../components/ui';

export type Action = { label: string; danger?: boolean; onClick: () => void };
export type Field = { key: string; label: string; value: string; placeholder?: string; type?: string };
export type Panel =
  | { kind: 'menu'; title: string; sub?: string; actions: Action[]; extra?: ReactNode }
  | { kind: 'form'; title: string; fields: Field[]; save: (v: Record<string, string>) => Promise<boolean> }
  | { kind: 'confirm'; title: string; text: string; confirm: string; onConfirm: () => Promise<boolean> }
  | { kind: 'place' }
  | { kind: 'ride' };

/** Блок карточки: заголовок, тихая кнопка «+ Добавить», компактный список. */
export function Block({ title, add, onAdd, hint, empty, children }: { title: string; add?: string; onAdd?: () => void; hint?: string; empty?: string; children: ReactNode[] }) {
  return (
    <section className="fc-block">
      <div className="fc-head">
        <h3>{title}</h3>
        {add && onAdd && (
          <button className="btn small secondary" onClick={onAdd}>
            + {add}
          </button>
        )}
      </div>
      {children.length ? <ul className="list">{children}</ul> : empty && <div className="card empty">{empty}</div>}
      {hint && <small className="page-sub">{hint}</small>}
    </section>
  );
}

export function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="more-btn" aria-label={label} title={label} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    </button>
  );
}

/** Нижняя панель: меню действий, короткая форма или подтверждение с последствиями. */
export function PanelSheet({ panel, onClose }: { panel: Panel | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (panel?.kind === 'form') setValues(Object.fromEntries(panel.fields.map((f) => [f.key, f.value])));
  }, [panel]);
  if (!panel || panel.kind === 'place' || panel.kind === 'ride') return null;
  const go = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose}>
      {panel.kind === 'menu' && (
        <>
          <div>
            <h3>{panel.title}</h3>
            {panel.sub && <div className="page-sub">{panel.sub}</div>}
          </div>
          {panel.extra}
          <div className="sheet-actions">
            {panel.actions.map((a) => (
              <button key={a.label} className={`sheet-action${a.danger ? ' danger' : ''}`} onClick={a.onClick}>
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
      {panel.kind === 'form' && (
        <form
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void go(() => panel.save(values));
          }}
        >
          <h3>{panel.title}</h3>
          {panel.fields.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`pf-${f.key}`}>{f.label}</label>
              <input id={`pf-${f.key}`} className="input" type={f.type ?? 'text'} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            </div>
          ))}
          <button className="btn block" disabled={busy || panel.fields.some((f) => f.key !== 'grade' && f.key !== 'entranceNote' && !(values[f.key] ?? '').trim())}>
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </form>
      )}
      {panel.kind === 'confirm' && (
        <>
          <h3>{panel.title}</h3>
          <p className="page-sub" style={{ margin: 0 }}>
            {panel.text}
          </p>
          <button className="btn danger block" disabled={busy} onClick={() => void go(panel.onConfirm)}>
            {panel.confirm}
          </button>
          <button className="btn secondary block" onClick={onClose}>
            Не надо
          </button>
        </>
      )}
    </Sheet>
  );
}
