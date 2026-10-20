// Подсказка: как поставить приложение на iPhone и включить уведомления.
import { useState } from 'react';
import { enablePush } from '../lib/push';
import { isIOS, isStandalone, pushSupported } from '../lib/platform';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function PushCard({ compact = false }: { compact?: boolean }) {
  const { me, reload } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  if (!me) return null;

  if (isIOS() && !isStandalone()) {
    return (
      <div className="note">
        <b>Поставьте приложение на экран «Домой»</b>
        <span>Без этого iPhone не покажет уведомления «в машине» и «передан».</span>
        <span>1. Нажмите «Поделиться» внизу Safari. 2. «На экран „Домой“». 3. Откройте приложение с новой иконки и войдите тем же кодом.</span>
      </div>
    );
  }
  if (me.pushEnabled && compact) return null;
  if (!pushSupported()) {
    return compact ? null : <div className="note plain">Этот браузер не умеет показывать уведомления. Откройте приложение в Safari (iPhone) или Chrome.</div>;
  }
  return (
    <div className={me.pushEnabled ? 'note plain' : 'note'}>
      <b>{me.pushEnabled ? 'Уведомления включены' : 'Включите уведомления'}</b>
      <span>{me.pushEnabled ? 'Статусы поездок приходят на этот телефон.' : 'Узнаете сразу, когда ребёнок в машине и когда передан.'}</span>
      <div className="btn-row">
        {!me.pushEnabled && (
          <button
            className="btn small"
            onClick={async () => {
              const r = await enablePush();
              setMsg(
                r === 'ok'
                  ? 'Готово, уведомления включены'
                  : r === 'denied'
                    ? 'Разрешение не выдано. Включите уведомления для НА МЕСТЕ в настройках телефона.'
                    : r === 'unsupported'
                      ? 'Этот браузер не поддерживает уведомления'
                      : 'Не получилось. Попробуйте ещё раз.',
              );
              await reload();
            }}
          >
            Включить
          </button>
        )}
        {me.pushEnabled && (
          <button
            className="btn small secondary"
            onClick={async () => {
              await api.post('/push/test');
              setMsg('Отправили проверочное уведомление');
            }}
          >
            Проверить
          </button>
        )}
      </div>
      {msg && <span>{msg}</span>}
    </div>
  );
}
