import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Badge, useUnread } from '../../components/Chat';

/** Нижняя панель родителя: профиль и чат. Главная — «Запланированные поездки». */
export function ParentLayout() {
  const unread = useUnread();
  // на внутренних экранах («Сегодня» с картой, «Новая поездка», чат) вместо меню — кнопка «назад»
  const inner = /^\/app\/(today|new|chat)/.test(useLocation().pathname);
  return (
    <div className={`app${inner ? ' no-tabbar' : ''}`}>
      <Outlet />
      {/* нижняя панель — только «Профиль» и «Чат» (как просила Анастасия); главная — «Запланированные поездки», назад — стрелкой в шапке */}
      {!inner && (
        <nav className="tabbar" style={{ ['--tabs' as string]: 2 }} aria-label="Разделы">
          <NavLink to="/app/family">Профиль</NavLink>
          <NavLink to="/app/chat">
            Чат
            <Badge n={unread} />
          </NavLink>
        </nav>
      )}
    </div>
  );
}
