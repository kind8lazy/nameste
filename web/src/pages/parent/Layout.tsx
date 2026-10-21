import { RoleSwitch } from '../../components/RoleSwitch';
import { NavLink, Outlet } from 'react-router-dom';
import { Badge, useUnread } from '../../components/Chat';

export function ParentLayout() {
  const unread = useUnread();
  return (
    <div className="app">
      <div style={{ padding: 'calc(var(--safe-top, 0px) + 12px) 16px 0', width: '100%', boxSizing: 'border-box' }}>
        <RoleSwitch />
      </div>
      <Outlet />
      <nav className="tabbar" style={{ ['--tabs' as string]: 4 }} aria-label="Разделы">
        <NavLink to="/app" end>
          Сегодня
        </NavLink>
        <NavLink to="/app/week">Неделя</NavLink>
        <NavLink to="/app/chat">
          Чат
          <Badge n={unread} />
        </NavLink>
        <NavLink to="/app/family">Семья</NavLink>
      </nav>
    </div>
  );
}
