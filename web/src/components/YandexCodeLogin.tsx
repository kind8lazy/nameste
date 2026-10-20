// Вход через Яндекс по коду: приложение показывает код, человек вводит его на странице Яндекса
// (в любом браузере или в приложении Яндекса), а приложение входит само — без возврата из браузера.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Me } from '@shared/api';

type Poll = { status: 'pending' | 'expired' } | { status: 'denied'; code?: string } | { status: 'ok'; me: Me };
interface Flow {
  userCode: string;
  verificationUrl: string;
  interval: number;
  deadline: number; // когда код перестанет действовать (время устройства)
}

const DENIED: Record<string, string> = {
  staff: 'Диспетчеру и водителю вход по коду закрыт. Войдите кнопкой «Войти через Яндекс» в браузере или кодом приглашения.',
  conflict: 'Этот Яндекс уже привязан к другому человеку или к аккаунту привязан другой Яндекс. Обратитесь к диспетчеру.',
  demo: 'В демо-режиме привязка Яндекса недоступна.',
  failed: 'Яндекс не подтвердил вход. Попробуйте ещё раз.',
};

export function YandexCodeLogin({ onDone, label = 'Войти по коду Яндекса' }: { onDone: (me: Me) => void; label?: string }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // приложение могло перезагрузиться, пока человек вводил код в браузере, — подхватываем начатый вход
  useEffect(() => {
    api
      .get<{ active: boolean; userCode?: string; verificationUrl?: string; interval?: number; expiresIn?: number }>('/auth/yandex/device/current')
      .then((c) => {
        if (c.active && c.userCode && c.verificationUrl) {
          setFlow({ userCode: c.userCode, verificationUrl: c.verificationUrl, interval: c.interval ?? 5, deadline: Date.now() + (c.expiresIn ?? 0) * 1000 });
        }
      })
      .catch(() => {});
  }, []);

  const start = async () => {
    setError(null);
    setCopied(false);
    try {
      const f = await api.post<{ userCode: string; verificationUrl: string; interval: number; expiresIn: number }>('/auth/yandex/device');
      setFlow({ userCode: f.userCode, verificationUrl: f.verificationUrl, interval: f.interval, deadline: Date.now() + f.expiresIn * 1000 });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось получить код');
    }
  };

  // опрашиваем сервер, пока человек подтверждает код в Яндексе
  useEffect(() => {
    if (!flow) return;
    let stopped = false;
    let inFlight = false;
    const stop = (msg: string | null) => {
      stopped = true;
      setFlow(null);
      setError(msg);
    };
    const tick = async () => {
      setLeft(Math.max(0, Math.round((flow.deadline - Date.now()) / 1000)));
      if (stopped || inFlight || document.visibilityState === 'hidden') return;
      if (Date.now() > flow.deadline) return stop('Код устарел. Получите новый.');
      inFlight = true;
      try {
        const r = await api.post<Poll>('/auth/yandex/device/poll');
        if (stopped) return;
        if (r.status === 'ok') {
          stopped = true;
          setFlow(null);
          onDoneRef.current(r.me);
        } else if (r.status === 'expired') stop('Код устарел. Получите новый.');
        else if (r.status === 'denied') stop(DENIED[r.code ?? 'failed'] ?? DENIED.failed);
      } catch {
        // нет связи — попробуем на следующем шаге
      } finally {
        inFlight = false;
      }
    };
    // чуть реже, чем разрешает Яндекс, чтобы сервер не отбрасывал опрос как слишком частый
    const poll = window.setInterval(tick, (Math.max(2, flow.interval) + 1) * 1000);
    const clock = window.setInterval(() => setLeft(Math.max(0, Math.round((flow.deadline - Date.now()) / 1000))), 1000);
    const onVisible = () => void tick();
    document.addEventListener('visibilitychange', onVisible);
    setLeft(Math.max(0, Math.round((flow.deadline - Date.now()) / 1000)));
    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [flow]);

  if (!flow) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <button type="button" className="btn secondary block" onClick={start}>
          {label}
        </button>
        {error && <div className="note error">{error}</div>}
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }} aria-live="polite">
      <b>Подтвердите вход в Яндексе</b>
      <ol style={{ margin: 0, paddingLeft: '1.2em', display: 'grid', gap: 6, fontSize: 15 }}>
        <li>Откройте страницу Яндекса по кнопке ниже.</li>
        <li>Войдите в свой Яндекс, если он попросит.</li>
        <li>Введите этот код и разрешите доступ:</li>
      </ol>
      <div className="code-input" style={{ fontSize: 34, fontWeight: 700, userSelect: 'all', letterSpacing: '0.18em' }}>
        {flow.userCode}
      </div>
      <div className="btn-row">
        <a className="btn" style={{ background: '#fc3f1d', color: '#fff' }} href={flow.verificationUrl} target="_blank" rel="noreferrer" onClick={() => void copy()}>
          Открыть Яндекс
        </a>
        <button type="button" className="btn secondary" onClick={copy}>
          {copied ? 'Код скопирован' : 'Скопировать код'}
        </button>
      </div>
      <div className="note" style={{ fontSize: 13 }}>
        Вводите код, только если он на вашем экране. НА МЕСТЕ никогда не просит прислать или ввести код, который вам продиктовали или прислали.
      </div>
      <span className="page-sub">
        Ждём подтверждения… Вернитесь сюда после ввода кода — вход произойдёт сам. Код действует ещё {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.
      </span>
      <button type="button" className="btn small secondary" onClick={() => setFlow(null)}>
        Отмена
      </button>
    </div>
  );
}
