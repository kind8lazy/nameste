import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { homeFor, useAuth } from '../lib/auth';
import type { Me } from '@shared/api';
import { YandexCodeLogin } from '../components/YandexCodeLogin';
import { isIOS, isStandalone } from '../lib/platform';
import { IconCalendar, IconCar, IconChat } from '../components/Tiles';

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
  const [codeOpen, setCodeOpen] = useState(false);
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

  const standalone = isStandalone();
  // кодом входят те, у кого нет Яндекса или кто открыл ссылку-приглашение; остальным форма не мешает
  const showCode = codeOpen || !yandex || !!params.get('code');

  return (
    <div className="app">
      <div className="page welcome" style={{ paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
        <section className="live welcome-hero">
          <div className="wordmark" style={{ padding: 0 }}>
            НА<i />МЕСТЕ
          </div>
          <div className="live-big">Развозка детей без звонков и переписок</div>
          <div className="live-line">Водитель отмечает каждый шаг — вы сразу знаете: выехал, ребёнок в машине, передан.</div>
        </section>

        <section className="card welcome-login">
          {yandex && !(isIOS() && standalone) && (
            <a className="btn block" style={{ background: '#fc3f1d', color: '#fff' }} href={`/api/auth/yandex/start?next=${encodeURIComponent(safeNext(params.get('next')) ?? '/')}`}>
              Войти через Яндекс
            </a>
          )}
          {yandex && <YandexCodeLogin label={isIOS() && standalone ? 'Войти через Яндекс' : 'Не получается? Войти по коду Яндекса'} onDone={(m) => setMe(m)} />}
          {showCode ? (
            <form style={{ display: 'grid', gap: 10 }} onSubmit={submit}>
              <div className="field">
                <label htmlFor="code">Код из приглашения диспетчера</label>
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
              <button className="btn block" disabled={busy || code.length < 6}>
                {busy ? 'Проверяю…' : 'Войти'}
              </button>
            </form>
          ) : (
            <button type="button" className="btn secondary block" onClick={() => setCodeOpen(true)}>
              У меня есть код приглашения
            </button>
          )}
          {error && <div className="note error">{error}</div>}
        </section>

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

        <section className="welcome-features" aria-label="Что умеет приложение">
          <Feature icon={<IconCar />} title="Каждый шаг поездки" text="Уведомления: водитель выехал, на месте, ребёнок в машине, передан взрослому." />
          <Feature icon={<IconCalendar />} title="Неделя наперёд" text="Все поездки детей на одном экране. Изменить время или отменить — в пару нажатий." />
          <Feature icon={<IconChat />} title="Диспетчер на связи" text="Чат вместо звонков. Диспетчер подтверждает изменения — он знает, где свободны водители." />
        </section>

        {!standalone && (
          <section className="card welcome-install">
            <b>Установите на телефон — как обычное приложение</b>
            {isIOS() ? (
              <ol>
                <li>Откройте эту страницу в Safari.</li>
                <li>Нажмите «Поделиться» (квадрат со стрелкой) внизу экрана.</li>
                <li>Выберите «На экран “Домой”» и войдите в появившемся приложении — тем же способом.</li>
              </ol>
            ) : (
              <ol>
                <li>Откройте эту страницу в Chrome.</li>
                <li>Нажмите ⋮ в правом верхнем углу.</li>
                <li>Выберите «Установить приложение» или «Добавить на главный экран».</li>
              </ol>
            )}
            <span className="page-sub">Без магазина приложений. Уведомления придут, как от любого приложения.</span>
          </section>
        )}
      </div>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="welcome-feature">
      <span className="tile-icon">{icon}</span>
      <span>
        <b>{title}</b>
        <small>{text}</small>
      </span>
    </div>
  );
}
