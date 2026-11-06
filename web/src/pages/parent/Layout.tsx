import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Badge, useUnread } from '../../components/Chat';

/** Нижняя панель родителя: поездки (главная), чат с диспетчером, профиль семьи. */
export function ParentLayout() {
  const unread = useUnread();
  // на внутренних экранах («Сегодня» с картой, «Новая поездка») вместо меню — кнопка «назад»
  const inner = /^\/app\/(today|new)/.test(useLocation().pathname);
  return (
    <div className={`app${inner ? ' no-tabbar' : ''}`}>
      <Outlet />
      {!inner && (
        <nav className="tabbar" style={{ ['--tabs' as string]: 3 }} aria-label="Разделы">
          <NavLink to="/app" end>
            Поездки
          </NavLink>
          <NavLink to="/app/chat">
            Чат
            <Badge n={unread} />
          </NavLink>
          <NavLink to="/app/family">Профиль</NavLink>
        </nav>
      )}
    </div>
  );
}
