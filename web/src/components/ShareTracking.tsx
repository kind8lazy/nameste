// Ссылка отслеживания на сегодня: для папы, бабушки, няни — без входа и без приложения.
import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export function ShareTracking() {
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const share = async () => {
    setMsg(null);
    try {
      const r = await api.post<{ url: string }>('/parent/track-link');
      setUrl(r.url);
      const text = 'Где сейчас дети — НА МЕСТЕ. Ссылка работает сегодня.';
      if (navigator.share) {
        try {
          await navigator.share({ title: 'НА МЕСТЕ', text, url: r.url });
          return;
        } catch {
          // человек закрыл окно «Поделиться» — покажем ссылку ниже
        }
      }
      try {
        await navigator.clipboard.writeText(r.url);
        setMsg('Ссылка скопирована. Отправьте её в мессенджер.');
      } catch {
        setMsg('Скопируйте ссылку и отправьте её в мессенджер.');
      }
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Не получилось создать ссылку');
    }
  };
  return (
    <div className="note plain">
      <b>Поделиться отслеживанием</b>
      <span>Папа, бабушка или няня увидят статус и машину на карте без приложения. Ссылка работает только сегодня.</span>
      <button className="btn small secondary" onClick={share}>
        Получить ссылку
      </button>
      {url && (
        <span style={{ userSelect: 'all', wordBreak: 'break-all', fontSize: 13 }}>
          {url}
        </span>
      )}
      {msg && <span>{msg}</span>}
    </div>
  );
}
