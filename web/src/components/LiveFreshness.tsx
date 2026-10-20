// Насколько свежие координаты машины. Если связи нет больше 2 минут — честно об этом говорим.
import { useEffect, useState } from 'react';

export function LiveFreshness({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.round((now - at) / 1000));
  const ago = sec < 60 ? `${sec} с назад` : `${Math.round(sec / 60)} мин назад`;
  if (sec > 120) {
    return (
      <div className="note" role="status">
        Машина не выходила на связь {ago}. На карте — последнее известное место. Статус поездки обновится, как только водитель отметит шаг.
      </div>
    );
  }
  return (
    <div className="page-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: '#2D7552', display: 'inline-block' }} />
      Машина на связи · обновлено {ago}
    </div>
  );
}
