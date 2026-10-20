// Семья: дети, уведомления, вход на другом устройстве, выход.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Avatar } from '../../components/ui';
import { PushCard } from '../../components/PushCard';
import { PlaceForm, type PlacePayload } from '../../components/PlaceForm';
import { YandexCodeLogin } from '../../components/YandexCodeLogin';
import { isIOS, isStandalone } from '../../lib/platform';
import type { ParentDay } from '@shared/api';

const SEAT = { none: 'без кресла', booster: 'бустер', seat: 'детское кресло' } as const;

export function Family() {
  const { me, setMe, reload } = useAuth();
  const [day, setDay] = useState<ParentDay | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [params, setParams] = useSearchParams();
  const [yandexOn, setYandexOn] = useState(false);
  useEffect(() => {
    api.get<{ enabled: boolean }>('/auth/yandex').then((d) => setYandexOn(d.enabled)).catch(() => {});
  }, []);
  const yandexResult = params.get('yandex');
  const YANDEX_RESULT: Record<string, string> = {
    linked: 'Яндекс привязан. Теперь можно входить через Яндекс.',
    conflict: 'Не получилось: этот Яндекс уже привязан к другому человеку или к вашему аккаунту привязан другой Яндекс. Обратитесь к диспетчеру.',
    demo: 'В демо-режиме привязка Яндекса недоступна.',
    cancelled: 'Привязка Яндекса отменена.',
    state: 'Привязка не завершилась. Попробуйте ещё раз или по коду.',
    failed: 'Не получилось привязать Яндекс. Попробуйте ещё раз или по коду.',
  };
  // код для другого устройства исчезает, когда перестаёт действовать
  useEffect(() => {
    if (!code) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [code]);
  const codeLeft = code ? Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (code && codeLeft === 0) setCode(null);
  }, [code, codeLeft]);
  const load = useCallback(async () => setDay(await api.get<ParentDay>('/parent/day')), []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">Семья</h1>
        <span className="page-sub">{me?.families[0]?.name}</span>
      </div>
      <div className="section-label">Дети</div>
      <ul className="list">
        {day?.children.map((c) => (
          <li key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px' }}>
            <Avatar child={c} size={40} />
            <div style={{ display: 'grid' }}>
              <b>{c.firstName}</b>
              <small className="page-sub">
                {[c.grade, SEAT[c.seat]].filter(Boolean).join(' · ')}
                {c.handoverTo.length ? ` · можно передать: ${c.handoverTo.join(', ')}` : ''}
              </small>
            </div>
          </li>
        ))}
      </ul>
      <p className="page-sub" style={{ margin: 0 }}>
        Изменить данные детей или расписание можно через диспетчера: напишите ему во вкладке «Чат».
      </p>

      <FamilyPlaces canEdit={!!me?.families.some((f) => f.canEdit)} />

      <div className="section-label">Уведомления</div>
      <PushCard />

      {yandexResult && YANDEX_RESULT[yandexResult] && (
        <div className={yandexResult === 'linked' ? 'note plain' : 'note error'} role="status">
          {YANDEX_RESULT[yandexResult]}
          <button className="btn small secondary" onClick={() => setParams({}, { replace: true })}>
            Понятно
          </button>
        </div>
      )}
      {!me?.yandexLinked && yandexOn && (
        <>
          <div className="section-label">Вход</div>
          <div className="note plain">
            <span>Привяжите Яндекс — и входить можно будет одной кнопкой, без кода.</span>
            {!(isIOS() && isStandalone()) && (
              <a className="btn small secondary" href="/api/auth/yandex/start?next=/app/family">
                Привязать Яндекс
              </a>
            )}
            <YandexCodeLogin label={isIOS() && isStandalone() ? 'Привязать Яндекс' : 'Привязать по коду'} onDone={() => void reload()} />
          </div>
        </>
      )}
      <div className="section-label">Другое устройство</div>
      <div className="note plain">
        <span>Чтобы войти на другом телефоне или в приложении с экрана «Домой», получите код. Он действует 10 минут.</span>
        {code ? (
          <>
            <b className="code-input" style={{ fontSize: 30 }}>
              {code.code}
            </b>
            <span className="page-sub">
              Действует ещё {Math.floor(codeLeft / 60)}:{String(codeLeft % 60).padStart(2, '0')}. Введите его на другом устройстве в поле «код».
            </span>
          </>
        ) : (
          <button
            className="btn small secondary"
            onClick={async () => {
              setCodeError(null);
              try {
                setCode(await api.post('/auth/device-code'));
              } catch (e) {
                setCodeError(e instanceof ApiError ? e.message : 'Не получилось получить код');
              }
            }}
          >
            Получить код
          </button>
        )}
        {codeError && <span className="page-sub">{codeError}</span>}
      </div>

      <div className="section-label">Безопасность</div>
      <div className="note plain">
        <span>Пришло уведомление о входе, который сделали не вы? Выйдите на всех устройствах и позвоните диспетчеру.</span>
        <button
          className="btn small danger"
          onClick={async () => {
            await api.post('/auth/logout-all');
            setMe(null);
          }}
        >
          Выйти на всех устройствах
        </button>
      </div>

      <button
        className="btn secondary block"
        onClick={async () => {
          await api.post('/auth/logout');
          setMe(null);
        }}
      >
        Выйти
      </button>
    </main>
  );
}

interface PlaceRow {
  id: string;
  name: string;
  address: string;
  familyId: string | null;
}

/** Места семьи: дом, школа, секции. Клиент добавляет их сам, а потом выбирает «откуда» и «куда» в новой поездке. */
function FamilyPlaces({ canEdit }: { canEdit: boolean }) {
  const [places, setPlaces] = useState<PlaceRow[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const load = useCallback(async () => setPlaces((await api.get<PlaceRow[]>('/parent/places')).filter((p) => p.familyId)), []);
  useEffect(() => {
    void load().catch(() => setPlaces([]));
  }, [load]);

  const save = async (p: PlacePayload) => {
    try {
      await api.post('/parent/places', p);
      setToast('Место добавлено. Теперь его можно выбрать в новой поездке.');
      await load();
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    }
  };

  return (
    <>
      <div className="section-label">Мои места</div>
      <ul className="list">
        {places?.map((p) => (
          <li key={p.id} style={{ padding: '12px 14px', display: 'grid' }}>
            <b>{p.name}</b>
            <small className="page-sub">{p.address}</small>
          </li>
        ))}
        {places && !places.length && <li className="empty">Мест пока нет. Добавьте дом, школу и секции.</li>}
      </ul>
      {toast && (
        <div className="note plain" role="status">
          {toast}
        </div>
      )}
      {canEdit ? <PlaceForm geocodePath="/parent/geocode" onSave={save} title="Добавить место" /> : <p className="page-sub">Добавлять места может владелец семьи или диспетчер.</p>}
    </>
  );
}
