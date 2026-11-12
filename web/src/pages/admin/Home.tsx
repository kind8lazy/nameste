// «Ещё» диспетчера на телефоне: всё, что нужно не каждую минуту, — одним списком.
// Каждый день — «Входящие», «Сегодня» и «Семьи» в нижнем меню; здесь сообщения, водители, настройки и другие режимы.
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, useUnread } from '../../components/Chat';
import { RoleRows } from '../../components/RoleSwitch';
import { Clock } from '../../components/Clock';
import { DeskTabbar } from './DeskNav';

export function DispatcherHome() {
  const { me, setMe } = useAuth();
  const unread = useUnread();
  const roles = [me?.roles.includes('dispatcher') && 'диспетчер', me?.roles.includes('driver') && 'водитель'].filter(Boolean).join(' и ');
  return (
    <div className="app">
      <main className="page">
        <div className="page-head">
          <Clock />
          <h1 className="page-title">{me?.name ?? 'Ещё'}</h1>
          <span className="page-sub">{roles}</span>
        </div>
        <ul className="list">
          <li>
            <Link to="/admin/chat" className="list-row">
              <b>Сообщения</b>
              <small>{unread > 0 ? <Badge n={unread} /> : '›'}</small>
            </Link>
          </li>
          <li>
            <Link to="/admin/access" className="list-row">
              <b>Водители и доступ</b>
              <small>›</small>
            </Link>
          </li>
          <li>
            <Link to="/admin/settings" className="list-row">
              <b>Настройки</b>
              <small>›</small>
            </Link>
          </li>
        </ul>
        <RoleRows current="dispatcher" />
        <button
          className="text-link"
          style={{ color: 'var(--mute)', fontWeight: 400 }}
          onClick={async () => {
            await api.post('/auth/logout');
            setMe(null);
          }}
        >
          Выйти
        </button>
      </main>
      <DeskTabbar />
    </div>
  );
}
