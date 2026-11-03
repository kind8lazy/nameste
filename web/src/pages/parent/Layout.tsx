import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Badge, useUnread } from '../../components/Chat';

export function ParentLayout() {
  const unread = useUnread();
  // на внутренних экранах («Сегодня», «Новая поездка») вместо меню — кнопка «назад»
  const inner = /^\/app\/(today|new)/.test(useLocation().pathname);
  return (
    <div className={`app${inner ? ' no-tabbar' : ''}`}>
      <Outlet />
      {!inner && <nav className="tabbar" style={{ ['--tabs' as string]: 4 }} aria-label="Разделы">
        <NavLink to="/app" end>
          Главная
        </NavLink>
        <NavLink to="/app/week">Неделя</NavLink>
        <NavLink to="/app/chat">
          Чат
          <Badge n={unread} />
        </NavLink>
        <NavLink to="/app/family">Семья</NavLink>
      </nav>}
    </div>
  );
}
