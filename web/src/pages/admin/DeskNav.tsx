// Меню диспетчера. На компьютере — боковое: разделы на каждый день, внизу настройки и другие режимы.
// На телефоне — нижнее: «Входящие · Сегодня · Семьи · Ещё»; главная — очередь решений.
import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
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
  const { me } = useAuth();
  const unread = useUnread();
  const inbox = useInboxCount();
  return (
    <>
    <DeskTabbar inbox={inbox} unread={unread} />
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
      <NavLink to="/admin/clients">Семьи</NavLink>
      <NavLink to="/admin/access">Водители и доступ</NavLink>
      <NavLink to="/admin/chat">
        Сообщения
        <Badge n={unread} />
      </NavLink>
      <div className="desk-nav-bottom">
        <NavLink to="/admin/settings">Настройки</NavLink>
        {me?.roles.includes('driver') && <NavLink to="/driver">Моя смена</NavLink>}
        <NavLink to="/app" end>
          Как родитель
        </NavLink>
      </div>
    </nav>
    </>
  );
}

/** На телефоне боковое меню прячется — вместо него нижнее меню, как у родителя. */
export function DeskTabbar({ inbox, unread }: { inbox?: number; unread?: number }) {
  const ownInbox = useInboxCount();
  const ownUnread = useUnread();
  const nInbox = inbox ?? ownInbox;
  const nUnread = unread ?? ownUnread;
  return (
    <nav className="tabbar desk-tabbar" style={{ ['--tabs' as string]: 4 }} aria-label="Разделы">
      <NavLink to="/admin/inbox">
        Входящие
        <Badge n={nInbox} />
      </NavLink>
      <NavLink to="/admin" end>
        Сегодня
      </NavLink>
      <NavLink to="/admin/clients">Семьи</NavLink>
      <NavLink to="/admin/m">
        Ещё
        <Badge n={nUnread} />
      </NavLink>
    </nav>
  );
}
