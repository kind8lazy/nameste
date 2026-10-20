// Демо: машина сама проезжает маршрут, а статусы, карта и уведомления идут как в настоящей смене.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

export function DemoCard() {
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ enabled: boolean }>('/auth/demo').then((d) => setEnabled(d.enabled)).catch(() => {});
  }, []);
  if (!enabled) return null;
  const call = async (url: string) => {
    try {
      const r = await api.post<{ message: string }>(url);
      setMsg(r.message);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Не получилось');
    }
  };
  return (
    <div className="note plain">
      <b>Демо-поездка</b>
      <span className="page-sub">Машина сама проедет ближайший забор: выедет, приедет к школе, посадит детей и развезёт их. Займёт 1–2 минуты.</span>
      <div className="btn-row">
        <button className="btn small gold" onClick={() => call('/demo/start')}>Поехали</button>
        <button className="btn small secondary" onClick={() => call('/demo/reset')}>Начать демо заново</button>
      </div>
      {msg && <span>{msg}</span>}
    </div>
  );
}
