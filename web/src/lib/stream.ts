// Живые обновления: подписка на события сервера (SSE) с автоматическим переподключением.
// Соединение одно на всё приложение: счётчики, меню и экраны подписываются на него, а не открывают своё —
// браузер держит не больше 6 соединений к сайту, лишние запросы иначе встают в очередь.
import { useEffect, useRef } from 'react';

type Handlers = Record<string, (data: unknown) => void>;
type Listener = (name: string, data: unknown) => void;

const listeners = new Set<Listener>();
const attached = new Set<string>();
let es: EventSource | null = null;
let retry: number | undefined;

function attach(name: string) {
  if (!es || attached.has(name)) return;
  attached.add(name);
  es.addEventListener(name, (e) => {
    let data: unknown;
    try {
      data = JSON.parse((e as MessageEvent).data);
    } catch {
      return; // пропускаем битое сообщение
    }
    for (const l of [...listeners]) l(name, data);
  });
}

function connect(names: string[]) {
  if (es) return names.forEach(attach);
  es = new EventSource('/api/stream');
  attached.clear();
  names.forEach(attach);
  es.onerror = () => {
    es?.close();
    es = null;
    window.clearTimeout(retry);
    // переподключаемся, только пока кто-то слушает
    retry = window.setTimeout(() => listeners.size && connect([...wanted]), 3000);
  };
}

const wanted = new Set<string>();

export function useStream(handlers: Handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const names = Object.keys(handlers).sort().join(',');
  useEffect(() => {
    if (!enabled) return;
    const own = names.split(',').filter(Boolean);
    own.forEach((n) => wanted.add(n));
    const listener: Listener = (name, data) => ref.current[name]?.(data);
    listeners.add(listener);
    connect(own);
    // вернулись в приложение — обновим данные сразу
    const onVisible = () => {
      if (document.visibilityState === 'visible') ref.current.refresh?.(null);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      listeners.delete(listener);
      document.removeEventListener('visibilitychange', onVisible);
      if (!listeners.size) {
        es?.close();
        es = null;
        window.clearTimeout(retry);
      }
    };
  }, [enabled, names]);
}
