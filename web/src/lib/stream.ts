// Живые обновления: подписка на события сервера (SSE) с автоматическим переподключением.
import { useEffect, useRef } from 'react';

type Handlers = Record<string, (data: unknown) => void>;

export function useStream(handlers: Handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    const open = () => {
      es = new EventSource('/api/stream');
      for (const name of Object.keys(ref.current)) {
        es.addEventListener(name, (e) => {
          try {
            ref.current[name]?.(JSON.parse((e as MessageEvent).data));
          } catch {
            /* пропускаем битое сообщение */
          }
        });
      }
      es.onerror = () => {
        es?.close();
        if (!closed) setTimeout(open, 3000);
      };
    };
    open();
    // вернулись в приложение — обновим данные сразу
    const onVisible = () => {
      if (document.visibilityState === 'visible') ref.current.refresh?.(null);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      closed = true;
      es?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
