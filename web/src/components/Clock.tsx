// Текущее время над заголовком экрана — как дата над крупным заголовком в iOS: «вторник, 3 ноября · 14:23».
// Время петербургское (как во всём приложении), обновляется ровно на смене минуты.
import { useEffect, useState } from 'react';
import { formatDayRu, localDate, localTime } from '@shared/time';

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    // телефон мог «уснуть»: при возвращении в приложение сразу показываем верное время
    const wake = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, []);
  return now;
}

export function Clock({ date = true }: { date?: boolean }) {
  const now = useNow();
  const time = localTime(now);
  return (
    <div className="page-clock">
      {date && <span>{formatDayRu(localDate(now))} · </span>}
      <time dateTime={time}>{time}</time>
    </div>
  );
}
