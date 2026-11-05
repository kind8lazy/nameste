// Семья: дети, уведомления, вход на другом устройстве, выход.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Avatar, Sheet, useToast } from '../../components/ui';
import { PushCard } from '../../components/PushCard';
import { PlaceForm, AddressPicker, type PlacePayload, type FoundPlace } from '../../components/PlaceForm';
import { MoreButton, PanelSheet, type Panel } from '../admin/Panels';
import { undoable } from './Requests';
import { YandexCodeLogin } from '../../components/YandexCodeLogin';
import { isIOS, isStandalone } from '../../lib/platform';
import type { ParentDay } from '@shared/api';
import { Clock } from '../../components/Clock';

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
        <Clock />
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
  entranceNote: string | null;
  familyId: string | null;
  pendingAddress: { changeId: string; address: string | null } | null;
}

/** Места семьи: дом, школа, секции. Клиент добавляет их сам, а потом выбирает «откуда» и «куда» в новой поездке.
 *  Название и «как пройти» меняются сразу (диспетчер и водители получат уведомление), новый адрес — только с согласия диспетчера:
 *  от адреса зависят маршрут и время в пути. Удалить можно место, по которому нет поездок. */
function FamilyPlaces({ canEdit }: { canEdit: boolean }) {
  const [places, setPlaces] = useState<PlaceRow[] | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [moving, setMoving] = useState<PlaceRow | null>(null);
  const toast = useToast();
  const load = useCallback(async () => setPlaces((await api.get<PlaceRow[]>('/parent/places')).filter((p) => p.familyId)), []);
  useEffect(() => {
    void load().catch(() => setPlaces([]));
  }, [load]);
  const reload = () => void load().catch(() => {});
  const ask = undoable(toast, reload);

  const save = async (p: PlacePayload) => {
    try {
      await api.post('/parent/places', p);
      toast.show('Место добавлено. Теперь его можно выбрать в новой поездке.');
      await load();
      return true;
    } catch (e) {
      toast.show((e as Error).message);
      return false;
    }
  };

  const menu = (p: PlaceRow) =>
    setPanel({
      kind: 'menu',
      title: p.name,
      sub: p.address,
      actions: [
        { label: 'Изменить название и «как пройти»', onClick: () => setPanel(editForm(p)) },
        ...(p.pendingAddress ? [] : [{ label: 'Сменить адрес', onClick: () => (setPanel(null), setMoving(p)) }]),
        { label: 'Удалить место', danger: true, onClick: () => setPanel(removeConfirm(p)) },
      ],
    });
  const editForm = (p: PlaceRow): Panel => ({
    kind: 'form',
    title: p.name,
    fields: [
      { key: 'name', label: 'Название', value: p.name },
      { key: 'entranceNote', label: 'Как пройти (увидит водитель)', value: p.entranceNote ?? '', placeholder: 'Вход со двора, 2 этаж' },
    ],
    save: async (v) => {
      try {
        await api.patch(`/parent/places/${p.id}`, { name: v.name.trim(), entranceNote: v.entranceNote.trim() });
        setPanel(null);
        toast.show('Сохранено. Диспетчер и водители увидят изменения.');
        reload();
        return true;
      } catch (e) {
        toast.show((e as Error).message);
        return false;
      }
    },
  });
  const removeConfirm = (p: PlaceRow): Panel => ({
    kind: 'confirm',
    title: `Удалить «${p.name}»?`,
    text: 'Место пропадёт из списка «откуда» и «куда». Если по нему есть поездки, удалить не получится — сначала их должен остановить диспетчер.',
    confirm: 'Удалить место',
    onConfirm: async () => {
      try {
        await api.del(`/parent/places/${p.id}`);
        setPanel(null);
        toast.show('Место удалено');
        reload();
        return true;
      } catch (e) {
        setPanel(null);
        toast.show((e as Error).message);
        return false;
      }
    },
  });

  return (
    <>
      <div className="section-label">Мои места</div>
      <ul className="list">
        {places?.map((p) => (
          <li key={p.id} className="place-row">
            <span>
              <b>{p.name}</b>
              <small className="page-sub">{p.address}</small>
              {p.entranceNote && <small className="page-sub">Как пройти: {p.entranceNote}</small>}
              {p.pendingAddress && <small className="place-pending">Новый адрес ждёт ответа диспетчера: {p.pendingAddress.address}</small>}
            </span>
            {canEdit && <MoreButton label={`Изменить «${p.name}»`} onClick={() => menu(p)} />}
          </li>
        ))}
        {places && !places.length && <li className="empty">Мест пока нет. Добавьте дом, школу и секции.</li>}
      </ul>
      {canEdit ? <PlaceForm geocodePath="/parent/geocode" onSave={save} title="Добавить место" /> : <p className="page-sub">Добавлять и менять места может владелец семьи или диспетчер.</p>}
      <PanelSheet panel={panel} onClose={() => setPanel(null)} />
      {moving && (
        <MoveSheet
          place={moving}
          onClose={() => setMoving(null)}
          onSent={(changeId) => {
            setMoving(null);
            ask('Новый адрес отправлен диспетчеру. Он поменяется после согласия.', changeId);
            reload();
          }}
        />
      )}
      {toast.node}
    </>
  );
}

/** Новый адрес места: те же подсказки и карта, что при добавлении. Уходит просьбой диспетчеру. */
function MoveSheet({ place, onClose, onSent }: { place: PlaceRow; onClose: () => void; onSent: (changeId: string) => void }) {
  const [picked, setPicked] = useState<FoundPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>(`/parent/places/${place.id}/address`, { address: picked.address, lat: picked.lat, lon: picked.lon });
      onSent(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose}>
      <div>
        <h3>Новый адрес «{place.name}»</h3>
        <div className="page-sub">Сейчас: {place.address}</div>
      </div>
      <AddressPicker geocodePath="/parent/geocode" picked={picked} onPick={setPicked} mapName={place.name} label="Новый адрес" />
      <small className="page-sub">От адреса зависят маршрут и время в пути, поэтому он поменяется после согласия диспетчера. Поездки до этого идут по старому адресу.</small>
      {error && <div className="note error">{error}</div>}
      <button className="btn block" disabled={!picked || busy} onClick={() => void send()}>
        {busy ? 'Отправляю…' : 'Отправить диспетчеру'}
      </button>
    </Sheet>
  );
}
