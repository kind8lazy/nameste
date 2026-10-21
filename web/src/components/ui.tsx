import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChildView } from '@shared/api';
import { PARENT_STEPS, type Tone } from '@shared/domain';

export function Avatar({ child, size = 30 }: { child: Pick<ChildView, 'firstName' | 'color' | 'photoUrl'>; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: child.photoUrl ? `url(${child.photoUrl}) center/cover` : child.color, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {child.photoUrl ? '' : child.firstName[0]}
    </span>
  );
}

export function Steps({ step }: { step: number }) {
  return (
    <ol className="steps" aria-label={`Шаг ${step} из 4`}>
      {PARENT_STEPS.map((label, i) => (
        <li key={label} className={i + 1 < step ? 'done' : i + 1 === step ? 'now' : step === 4 && i === 3 ? 'now' : ''}>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`tag tone-${tone}`}>{children}</span>;
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function useToast() {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (t: string) => {
    setText(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setText(null), 5500);
  };
  const node = text ? (
    <div className="toast" role="status">
      {text}
    </div>
  ) : null;
  return { show, node };
}

/** Подтверждение свайпом: случайным касанием действие не запустить. Enter на клавиатуре тоже работает. */
export function SwipeButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => Promise<void> | void; disabled?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = useRef(0);
  const max = () => (track.current ? track.current.clientWidth - 56 : 200);
  const fire = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setDx(0);
    }
  };
  useEffect(() => {
    if (disabled) setDx(0);
  }, [disabled]);
  return (
    <div
      ref={track}
      className={`swipe${drag ? ' dragging' : ''}${busy || disabled ? ' busy' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${label} — сдвиньте вправо`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !busy && !disabled) void fire();
      }}
      onPointerDown={(e) => {
        if (busy || disabled) return;
        start.current = e.clientX - dx;
        setDrag(true);
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        setDx(Math.max(0, Math.min(max(), e.clientX - start.current)));
      }}
      onPointerUp={() => {
        if (!drag) return;
        setDrag(false);
        if (dx > max() * 0.8) void fire();
        else setDx(0);
      }}
      onPointerCancel={() => {
        setDrag(false);
        setDx(0);
      }}
    >
      <span className="knob" style={{ transform: `translateX(${dx}px)` }}>
        →
      </span>
      {busy ? 'Отправляю…' : label}
    </div>
  );
}
