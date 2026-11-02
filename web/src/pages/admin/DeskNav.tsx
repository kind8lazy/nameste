// Меню диспетчера — одно на всех экранах: пять разделов на каждый день и настройки внизу.
import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { useStream } from '../../lib/stream';
import { Badge, useUnread } from '../../components/Chat';

/** Сколько просьб и заявок ждут решения — для счётчика «Входящих». */
export function useInboxCount(): number {
  const [n, setN] = useState(0);
  const load = useCallback(async () => {
    const [changes, requests] = await Promise.all([api.get<{ status: string }[]>('/admin/changes'), api.get<{ status: string }[]>('/admin/requests')]);
    setN(changes.filter((c) => c.status === 'new').length + requests.filter((r) => r.status === 'new').length);
  }, []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  useStream({ rides: () => void load().catch(() => {}), refresh: () => void load().catch(() => {}) });
  return n;
}

export function DeskNav() {
  const unread = useUnread();
  const inbox = useInboxCount();
  const { pathname, hash } = useLocation();
  // «Водители и доступ» пока живут на странице клиентов, в разделе #access
  const access = pathname === '/admin/clients' && hash === '#access';
  return (
    <nav className="desk-nav">
      <div className="wordmark">
        НА
        <i />
        МЕСТЕ
      </div>
      <NavLink to="/admin" end>
        Сегодня
      </NavLink>
      <NavLink to="/admin/inbox">
        Входящие
        <Badge n={inbox} />
      </NavLink>
      <NavLink to="/admin/clients" className={({ isActive }) => (isActive && !access ? 'active' : '')}>
        Семьи
      </NavLink>
      <Link to="/admin/clients#access" className={access ? 'active' : ''}>
        Водители и доступ
      </Link>
      <NavLink to="/admin/chat">
        Сообщения
        <Badge n={unread} />
      </NavLink>
      <div className="desk-nav-bottom">
        <NavLink to="/admin/settings">Настройки</NavLink>
      </div>
    </nav>
  );
}
