// Сообщения для диспетчера и водителя: все семьи и чат команды.
import { Link, useSearchParams } from 'react-router-dom';
import { ChatBrowser, Badge, useUnread } from '../../components/Chat';
import { useAuth } from '../../lib/auth';

/** Диспетчер видит это на компьютере с меню слева, водитель — на телефоне. */
export function StaffChat() {
  const [params] = useSearchParams();
  const { me } = useAuth();
  const unread = useUnread();
  const desk = !!me?.roles.includes('dispatcher');
  if (!desk) {
    return (
      <div className="app theme-driver">
        <main className="page">
          <div className="page-head">
            <h1 className="page-title">Сообщения</h1>
            <Link to="/driver" className="btn small secondary">
              ‹ Смена
            </Link>
          </div>
          <ChatBrowser initial={params.get('thread')} />
        </main>
      </div>
    );
  }
  return (
    <div className="desk" style={{ gridTemplateColumns: '210px 1fr' }}>
      <nav className="desk-nav">
        <div className="wordmark">
          НА<i />МЕСТЕ
        </div>
        <Link to="/admin">Диспетчерская</Link>
        <Link to="/admin/clients">Клиенты</Link>
        <a className="active">
          Сообщения
          <Badge n={unread} />
        </a>
      </nav>
      <main className="desk-main" style={{ maxWidth: 1100 }}>
        <h1 className="page-title">Сообщения</h1>
        <ChatBrowser initial={params.get('thread')} />
      </main>
    </div>
  );
}
