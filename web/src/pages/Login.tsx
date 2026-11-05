import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { homeFor, useAuth } from '../lib/auth';
import type { Me } from '@shared/api';
import { YandexCodeLogin } from '../components/YandexCodeLogin';
import { isIOS, isStandalone } from '../lib/platform';
import { IconCalendar, IconCar, IconChat, IconPause } from '../components/Tiles';

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
  const { me, setMe, loading } = useAuth();
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

  const redeem = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const m = await api.post<Me>('/auth/redeem', { code: value });
      setMe(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не получилось войти');
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  // ссылка-приглашение с кодом: входим сразу, без лишних нажатий
  const autoTried = useRef(false);
  // ждём, пока приложение узнает, вошёл ли человек, — иначе ответ «не вошёл» затрёт успешный вход
  useEffect(() => {
    const c = (params.get('code') ?? '').replace(/\D/g, '');
    if (loading || me || autoTried.current || c.length < 6) return;
    autoTried.current = true;
    void redeem(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, me]);

  const standalone = isStandalone();
  // кодом входят те, у кого нет Яндекса или кто открыл ссылку-приглашение; остальным форма не мешает
  const codeMode = codeOpen || !!params.get('code');
  const yandexHref = `/api/auth/yandex/start?next=${encodeURIComponent(safeNext(params.get('next')) ?? '/')}`;

  if (codeMode)
    return (
      <CodeScreen
        code={code}
        setCode={(v) => {
          setCode(v);
          setError(null);
          // набрали все 8 цифр — входим сами
          if (v.length === 8) void redeem(v);
        }}
        busy={busy}
        error={error}
        onSubmit={() => void redeem(code)}
        onBack={() => {
          setCodeOpen(false);
          setError(null);
          if (params.get('code')) nav('/login', { replace: true });
        }}
        yandexHref={yandex && !(isIOS() && standalone) ? yandexHref : null}
      />
    );

  return (
    <div className="welcome">
      <header className="welcome-top">
        <div className="wordmark" style={{ padding: 0, color: 'var(--navy)' }}>
          НА<i />МЕСТЕ
        </div>
        <nav>
          <a href="#how">Как это работает</a>
          <a href="#install">Установка</a>
        </nav>
      </header>

      <section className="welcome-hero">
        <div className="welcome-copy">
          <span className="welcome-badge">
            <i />
            Развозка детей · Санкт-Петербург
          </span>
          <h1>
            Ребёнок едет — <em>вы спокойны</em>
          </h1>
          <p>Водитель отмечает каждый шаг поездки, а вы сразу получаете уведомление: выехал, на месте, в машине, передан. Без звонков и переписок.</p>

          <div className="welcome-login">
            {yandex && !(isIOS() && standalone) && (
              <a className="welcome-btn primary" href={yandexHref}>
                Войти через Яндекс <span aria-hidden>→</span>
              </a>
            )}
            <button type="button" className={`welcome-btn ${yandex ? 'ghost' : 'primary'}`} onClick={() => setCodeOpen(true)}>
              {yandex ? 'У меня есть код приглашения' : 'Войти по коду'}
            </button>
            {yandex && <YandexCodeLogin label={isIOS() && standalone ? 'Войти через Яндекс' : 'Не получается? Войти по коду Яндекса'} onDone={(m) => setMe(m)} />}
            {error && <div className="note error">{error}</div>}
          </div>
          <small className="welcome-note">Код приглашения присылает диспетчер. Работает в браузере, можно добавить на экран телефона.</small>
        </div>

        <PhoneScene />
      </section>

      {demo && (
        <section className="welcome-section">
          <div className="card" style={{ padding: 16, display: 'grid', gap: 10, maxWidth: 560 }}>
            <b>Демо-режим</b>
            <span className="page-sub">Войдите за любую роль без кода. Данные выдуманные: семья Маши и Лёвы.</span>
            <button className="btn block" onClick={() => demoLogin('parent', '/app')}>Родитель (мама)</button>
            <button className="btn secondary block" onClick={() => demoLogin('grandma', '/app')}>Бабушка — только «передан»</button>
            <button className="btn gold block" onClick={() => demoLogin('driver', '/driver')}>Водитель</button>
            <button className="btn secondary block" onClick={() => demoLogin('driver', '/admin')}>Диспетчер (компьютер)</button>
          </div>
        </section>
      )}

      <section className="welcome-section" id="how">
        <h2>Как это работает</h2>
        <div className="welcome-cards">
          <Feature tone="gold" icon={<IconCar />} title="Каждый шаг поездки" text="Уведомления: водитель выехал, на месте, ребёнок в машине, передан взрослому." />
          <Feature tone="navy" icon={<IconCalendar />} title="Неделя наперёд" text="Все поездки детей на одном экране. Изменить время или отменить — в пару нажатий." />
          <Feature tone="green" icon={<IconChat />} title="Диспетчер на связи" text="Чат вместо звонков. Диспетчер подтверждает изменения — он знает, где свободны водители." />
        </div>
      </section>

      {!standalone && (
        <section className="welcome-section" id="install">
          <h2>Установите на телефон</h2>
          <p className="welcome-lead">Без магазина приложений. Уведомления придут, как от любого приложения.</p>
          <div className="welcome-install">
            <InstallCard
              title="iPhone"
              browser="в Safari"
              steps={['Откройте эту страницу в Safari.', 'Нажмите «Поделиться» — квадрат со стрелкой внизу.', 'Выберите «На экран “Домой”».', 'Откройте приложение с экрана и войдите тем же способом.']}
            />
            <InstallCard
              title="Android"
              browser="в Chrome"
              steps={['Откройте эту страницу в Chrome.', 'Нажмите ⋮ в правом верхнем углу.', 'Выберите «Установить приложение».', 'Откройте приложение с экрана и войдите.']}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function Feature({ icon, title, text, tone }: { icon: React.ReactNode; title: string; text: string; tone: 'gold' | 'navy' | 'green' }) {
  return (
    <div className="welcome-card">
      <span className={`welcome-card-icon tone-${tone}`}>{icon}</span>
      <b>{title}</b>
      <p>{text}</p>
    </div>
  );
}

function InstallCard({ title, browser, steps }: { title: string; browser: string; steps: string[] }) {
  return (
    <div className="welcome-card">
      <b>
        {title} <small>{browser}</small>
      </b>
      <ol className="welcome-steps">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

/** Два телефона внахлёст с живой вёрсткой наших экранов: спереди — главная родителя, сзади — смена водителя. */
function PhoneScene() {
  return (
    <div className="phone-scene" aria-hidden>
      <div className="phone back">
        <div className="phone-screen dark">
          <StatusBar dark />
          <div className="mock-pad">
            <div className="mock-title light">Смена</div>
            <div className="mock-days">
              {['пн', 'вт', 'ср', 'чт', 'пт'].map((d, i) => (
                <span key={d} className={i === 1 ? 'on' : ''}>
                  <small>{d}</small>
                  {3 + i}
                </span>
              ))}
            </div>
            <div className="mock-stop now">
              <b>08:00 · Забрать</b>
              <small>Дом → Школа · Дарья</small>
              <span className="mock-swipe">Посадил Дарью →</span>
            </div>
            <div className="mock-stop">
              <b>08:18 · Высадить</b>
              <small>Школа, вход со двора</small>
            </div>
          </div>
        </div>
      </div>
      <div className="phone front">
        <div className="phone-screen">
          <StatusBar />
          <div className="mock-pad">
            <div className="mock-title">Маша, Лёва</div>
            <small className="mock-sub">вторник, 3 ноября</small>
            <MockTile title="Сегодня" sub="Маша в машине · будет в 14:33" accent icon={<IconCar />} />
            <MockTile title="Неделя" sub="12 поездок · дальше чт в 14:20" icon={<IconCalendar />} />
            <MockTile title="Ребёнка не будет" sub="Диспетчер отменит поездки" icon={<IconPause />} />
            <MockTile title="Чат с диспетчером" sub="Вопросы и пожелания" icon={<IconChat />} />
          </div>
          <div className="mock-tabbar">
            <span className="on">Главная</span>
            <span>Неделя</span>
            <span>Чат</span>
            <span>Семья</span>
          </div>
        </div>
      </div>
      <div className="phone-toast">
        <span className="tile-icon">
          <IconCar />
        </span>
        <span>
          <b>Маша в машине</b>
          <small>14:23 · водитель Надежда</small>
        </span>
      </div>
    </div>
  );
}

function StatusBar({ dark }: { dark?: boolean }) {
  return (
    <div className={`phone-status${dark ? ' dark' : ''}`}>
      <span>9:41</span>
      <i className="phone-island" />
      <span className="phone-icons">●●● ▮</span>
    </div>
  );
}

function MockTile({ title, sub, icon, accent }: { title: string; sub: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`mock-tile${accent ? ' accent' : ''}`}>
      <span className="tile-icon">{icon}</span>
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </div>
  );
}

/** Вход по коду: отдельный экран, 8 крупных ячеек, клавиатура цифр сразу, вход сам после 8-й цифры. */
function CodeScreen({ code, setCode, busy, error, onSubmit, onBack, yandexHref }: { code: string; setCode: (v: string) => void; busy: boolean; error: string | null; onSubmit: () => void; onBack: () => void; yandexHref: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  // фокус сразу и снова после проверки — клавиатура не закрывается после ошибки
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy]);
  return (
    <div className="code-screen">
      <header className="code-top">
        <button type="button" className="back-btn" aria-label="Назад" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="wordmark" style={{ padding: 0, color: 'var(--navy)' }}>
          НА<i />МЕСТЕ
        </div>
      </header>
      <form
        className="code-body"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h1>Вход по коду</h1>
        <p>Введите цифры из сообщения диспетчера.</p>
        <label className="otp" onClick={() => input.current?.focus()}>
          <input
            ref={input}
            id="code"
            className="otp-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            aria-label="Код из приглашения"
            maxLength={8}
            value={code}
            readOnly={busy}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`otp-cell${i === Math.min(code.length, 7) && !busy ? ' on' : ''}${code[i] ? ' filled' : ''}${error ? ' bad' : ''}`} aria-hidden>
              {code[i] ?? ''}
            </span>
          ))}
        </label>
        {error ? <div className="note error">{error}</div> : <small className="code-hint">{busy ? 'Проверяю…' : 'Код действует 3 дня. После 8-й цифры войдём сами.'}</small>}
        <button className="welcome-btn primary" disabled={busy || code.length < 6}>
          {busy ? 'Проверяю…' : 'Войти'}
        </button>
        {yandexHref && (
          <a className="code-alt" href={yandexHref}>
            Нет кода? Войти через Яндекс
          </a>
        )}
      </form>
    </div>
  );
}
