import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { homeFor, useAuth } from '../lib/auth';
import type { Me } from '@shared/api';
import { YandexCodeLogin } from '../components/YandexCodeLogin';
import { isIOS, isStandalone } from '../lib/platform';

/** Текст ошибки выбирает приложение по коду — на странице входа нельзя показать произвольную «инструкцию». */
const LOGIN_ERRORS: Record<string, string> = {
  cancelled: 'Вы отменили вход через Яндекс.',
  state: 'Вход через Яндекс не завершён. Попробуйте ещё раз или войдите по коду.',
  conflict: 'Этот Яндекс уже привязан к другому человеку. Обратитесь к диспетчеру.',
  demo: 'В демо-режиме привязка Яндекса недоступна.',
  failed: 'Не получилось войти через Яндекс. Попробуйте ещё раз или войдите по коду.',
  disabled: 'Вход через Яндекс пока не настроен.',
};

/** Только разделы приложения: никаких перенаправлений на чужие сайты. */
function safeNext(next: string | null): string | null {
  if (!next) return null;
  return /^\/(app|driver|admin|t)(\/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9_\-=&%.]*)?$/.test(next) ? next : null;
}

export function Login() {
  const [params] = useSearchParams();
  const { me, setMe } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(LOGIN_ERRORS[params.get('error') ?? ''] ?? null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const demoTarget = useRef<string | null>(null);
  const [yandex, setYandex] = useState(false);
  useEffect(() => {
    api.get<{ enabled: boolean }>('/auth/yandex').then((d) => setYandex(d.enabled)).catch(() => {});
  }, []);
  useEffect(() => {
    api.get<{ enabled: boolean }>(`/auth/demo?key=${encodeURIComponent(params.get('demo') ?? '')}`).then((d) => setDemo(d.enabled)).catch(() => {});
  }, []);
  const demoLogin = async (role: 'parent' | 'grandma' | 'driver', next?: string) => {
    try {
      const m = await api.post<Me>('/auth/demo', { role, key: params.get('demo') ?? undefined });
      demoTarget.current = next ?? null;
      setMe(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не получилось войти');
    }
  };

  useEffect(() => {
    if (me) nav(demoTarget.current || safeNext(params.get('next')) || homeFor(me), { replace: true });
  }, [me, nav, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = await api.post<Me>('/auth/redeem', { code });
      setMe(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не получилось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="page" style={{ justifyContent: 'center', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
        <div className="live" style={{ padding: 22 }}>
          <div className="wordmark" style={{ padding: 0 }}>
            НА<i />МЕСТЕ
          </div>
          <div className="live-big">Развозка детей</div>
          <div className="live-line">Где сейчас ребёнок — видно в реальном времени.</div>
        </div>
        {yandex && (
          <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
            <b>Вход через Яндекс ID</b>
            {/* в приложении с экрана «Домой» на iPhone возврат из Яндекса не попадает обратно — там только вход по коду */}
            {!(isIOS() && isStandalone()) && (
              <a className="btn block" style={{ background: '#fc3f1d', color: '#fff' }} href={`/api/auth/yandex/start?next=${encodeURIComponent(safeNext(params.get('next')) ?? '/')}`}>
                Войти через Яндекс
              </a>
            )}
            <YandexCodeLogin
              label={isIOS() && isStandalone() ? 'Войти через Яндекс' : 'Не получается? Войти по коду'}
              onDone={(m) => setMe(m)}
            />
          </div>
        )}
        {demo && (
          <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
            <b>Демо-режим</b>
            <span className="page-sub">Войдите за любую роль без кода. Данные выдуманные: семья Маши и Лёвы.</span>
            <button className="btn block" onClick={() => demoLogin('parent', '/app')}>Родитель (мама)</button>
            <button className="btn secondary block" onClick={() => demoLogin('grandma', '/app')}>Бабушка — только «передан»</button>
            <button className="btn gold block" onClick={() => demoLogin('driver', '/driver')}>Водитель</button>
            <button className="btn secondary block" onClick={() => demoLogin('driver', '/admin')}>Диспетчер (компьютер)</button>
          </div>
        )}
        <form className="card" style={{ padding: 16, display: 'grid', gap: 12 }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="code">Или код из приглашения диспетчера</label>
            <input
              id="code"
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="00000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </div>
          {error && <div className="note error">{error}</div>}
          <button className="btn block" disabled={busy || code.length < 6}>
            {busy ? 'Проверяю…' : 'Войти'}
          </button>
          <p className="page-sub" style={{ margin: 0 }}>
            Код присылает диспетчер НА МЕСТЕ. На iPhone сначала добавьте приложение на экран «Домой», потом войдите в нём — тем же кодом.
          </p>
        </form>
      </div>
    </div>
  );
}
