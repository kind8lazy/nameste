// Плашка роли для тех, у кого несколько ролей (диспетчер): всегда видно, кто вы сейчас и где,
// и можно перейти в другую роль. У каждой роли свой цвет — плашка и рамка экрана красятся в него.
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, dispatcherHome } from '../lib/auth';

type RoleKey = 'dispatcher' | 'driver' | 'parent';

const ROLE_NAME: Record<RoleKey, string> = { dispatcher: 'Диспетчер', driver: 'Водитель', parent: 'Родитель' };

/** Раздел по адресу: от более точного к общему. */
const SECTIONS: [RegExp, RoleKey, string][] = [
  [/^\/admin\/clients\/[^/]+/, 'dispatcher', 'Карточка семьи'],
  [/^\/admin\/clients/, 'dispatcher', 'Клиенты'],
  [/^\/admin\/chat/, 'dispatcher', 'Сообщения'],
  [/^\/admin\/m$/, 'dispatcher', 'Главная'],
  [/^\/admin\/inbox/, 'dispatcher', 'Входящие'],
  [/^\/admin\/settings/, 'dispatcher', 'Настройки'],
  [/^\/admin/, 'dispatcher', 'Сегодня'],
  [/^\/driver\/chat/, 'driver', 'Сообщения'],
  [/^\/driver\/shift/, 'driver', 'Смена'],
  [/^\/driver/, 'driver', 'Главная'],
  [/^\/app\/week/, 'parent', 'Неделя'],
  [/^\/app\/family/, 'parent', 'Семья'],
  [/^\/app\/new/, 'parent', 'Новая поездка'],
  [/^\/app\/chat/, 'parent', 'Чат'],
  [/^\/app\/today/, 'parent', 'Сегодня'],
  [/^\/app/, 'parent', 'Главная'],
];

export function roleOfPath(path: string): { role: RoleKey; section: string } | null {
  const hit = SECTIONS.find(([re]) => re.test(path));
  return hit ? { role: hit[1], section: hit[2] } : null;
}

export function RoleBar() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const where = roleOfPath(pathname);
  const multi = !!me?.roles.includes('dispatcher');

  // цвет роли на весь экран: рамка и плашка (см. html.role-* в styles.css)
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('role-dispatcher', 'role-driver', 'role-parent');
    if (multi && where) root.classList.add(`role-${where.role}`);
    return () => root.classList.remove('role-dispatcher', 'role-driver', 'role-parent');
  }, [multi, where?.role]);

  if (!multi || !where) return null;
  return (
    <header className={`role-bar role-bar-${where.role}`}>
      <div className="role-bar-now">
        <span>Вы сейчас</span>
        <b>{ROLE_NAME[where.role]}</b>
        <span className="role-bar-section">· {where.section}</span>
      </div>
      <nav className="role-bar-tabs" aria-label="Сменить роль">
        <NavLink to={dispatcherHome()} className={where.role === 'dispatcher' ? 'on' : ''}>
          Диспетчер
        </NavLink>
        {me!.roles.includes('driver') && (
          <NavLink to="/driver" className={where.role === 'driver' ? 'on' : ''}>
            Водитель
          </NavLink>
        )}
        <NavLink to="/app" end className={where.role === 'parent' ? 'on' : ''}>
          Родитель
        </NavLink>
      </nav>
    </header>
  );
}
