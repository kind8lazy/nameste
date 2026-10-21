// Переключатель разделов для диспетчера: диспетчерская, смена водителя, экран родителя — без повторного входа.
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function RoleSwitch() {
  const { me } = useAuth();
  if (!me?.roles.includes('dispatcher')) return null;
  return (
    <nav className="role-switch" aria-label="Роль">
      <NavLink to="/admin" end>Диспетчер</NavLink>
      {me.roles.includes('driver') && <NavLink to="/driver">Водитель</NavLink>}
      <NavLink to="/app" end>Родитель</NavLink>
    </nav>
  );
}
