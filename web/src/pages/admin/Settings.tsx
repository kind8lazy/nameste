// Настройки диспетчера: то, что нужно редко, — журнал уведомлений и выход на всех устройствах.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Clock } from '../../components/Clock';
import { DeskNav } from './DeskNav';

interface NotificationRow {
  id: string;
  userName?: string;
  title: string;
  body?: string;
  status: string;
  channel: string;
  createdAt: string;
}

interface Status {
  provider: string;
  testMode: boolean;
  mail: string;
  mailFrom: string;
  yandex: boolean;
  demo: boolean;
}

export function Settings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testMsg, setTestMsg] = useState<string | null>(null);
  useEffect(() => {
    api.get<Status>('/admin/sms').then(setStatus).catch(() => setStatus(null));
  }, []);
  const { me, setMe } = useAuth();
  const [log, setLog] = useState<NotificationRow[]>([]);
  const [logins, setLogins] = useState(false);
  useEffect(() => {
    api
      .get<NotificationRow[]>('/admin/notifications')
      .then(setLog)
      .catch(() => setLog([]));
  }, []);
  // уведомления о входе — служебные, по умолчанию прячем, чтобы видеть, что получили семьи
  const shown = log.filter((n) => logins || !n.title.startsWith('Новый вход'));
  return (
    <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>
      <DeskNav />
      <main className="desk-main" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <Clock />
          <h1 className="page-title">Настройки</h1>
        </div>

        <section className="fc-block">
          <h3>Подключения</h3>
          {status && (
            <ul className="list">
              <li className="fc-row">
                <span className="fc-main">
                  <b>Письма на почту</b>
                  <small>{status.mail === 'none' ? 'выключены' : status.mail === 'log' ? 'проверка без отправки' : `включены · ${status.mailFrom}`}</small>
                </span>
              </li>
              <li className="fc-row">
                <span className="fc-main">
                  <b>Вход через Яндекс</b>
                  <small>{status.yandex ? 'включён' : 'не настроен'}</small>
                </span>
              </li>
              {status.provider !== 'none' && (
                <li className="fc-row">
                  <span className="fc-main">
                    <b>SMS</b>
                    <small>{status.provider === 'log' ? 'проверка без отправки' : `${status.provider === 'yandex' ? 'Яндекс' : 'sms.ru'}, ${status.testMode ? 'тест' : 'боевой'}`}</small>
                  </span>
                </li>
              )}
              <li className="fc-row">
                <span className="fc-main">
                  <b>Демо-режим</b>
                  <small>{status.demo ? 'включён' : 'выключен'}</small>
                </span>
              </li>
            </ul>
          )}
          <form
            className="btn-row"
            style={{ alignItems: 'end', flexWrap: 'wrap' }}
            onSubmit={async (e) => {
              e.preventDefault();
              setTestMsg(null);
              try {
                const r = await api.post<{ ok: boolean; error?: string }>('/admin/mail/test', { email: testEmail });
                setTestMsg(r.ok ? 'Проверочное письмо отправлено' : `Письмо не ушло: ${r.error}`);
              } catch (err) {
                setTestMsg((err as Error).message);
              }
            }}
          >
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label htmlFor="mail-test">Проверить письма: адрес почты</label>
              <input id="mail-test" type="email" className="input" placeholder="name@yandex.ru" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
            </div>
            <button className="btn secondary" style={{ flex: 1 }} disabled={!testEmail.includes('@')}>
              Отправить проверочное
            </button>
          </form>
          {testMsg && <small className="page-sub">{testMsg}</small>}
        </section>

        <section style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <h3>Журнал уведомлений</h3>
            <label className="page-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={logins} onChange={(e) => setLogins(e.target.checked)} />
              показывать входы в приложение
            </label>
          </div>
          <div className="card" style={{ padding: 0, maxHeight: 460, overflow: 'auto' }}>
            <table className="table" style={{ border: 0 }}>
              <tbody>
                {shown.slice(0, 60).map((n) => (
                  <tr key={n.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(n.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      {n.title}
                      <br />
                      <small className="page-sub">
                        {n.userName} · {n.channel === 'email' ? 'письмо' : n.channel === 'sms' ? 'SMS' : 'в приложении'} ·{' '}
                        {n.status === 'sent' ? 'отправлено' : n.status === 'no_device' ? 'приложение не установлено' : 'ошибка'}
                      </small>
                    </td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td className="page-sub">Пока пусто</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" style={{ padding: 16, display: 'grid', gap: 8, justifyItems: 'start' }}>
          <b>Безопасность</b>
          <span className="page-sub">Если пришло уведомление о входе, который сделали не вы, — выйдите на всех устройствах и войдите заново.</span>
          <div className="btn-row" style={{ flex: 'none' }}>
            <button
              className="btn small secondary"
              onClick={async () => {
                await api.post('/auth/logout');
                setMe(null);
              }}
            >
              Выйти{me ? ` (${me.name})` : ''}
            </button>
            <button
              className="btn small danger"
              onClick={async () => {
                if (!window.confirm('Выйти на всех устройствах? Войти можно будет снова через Яндекс или мастер-код.')) return;
                await api.post('/auth/logout-all');
                setMe(null);
              }}
            >
              Выйти на всех устройствах
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
