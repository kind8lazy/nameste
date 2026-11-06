// «Режим» — для тех, у кого несколько ролей (диспетчер, который ещё и водитель и смотрит как родитель).
// Полосы ролей над экраном нет: роль видна по самому экрану, а переключатель живёт в «Профиле»,
// в «Ещё» у диспетчера и на главной водителя. Текущий режим отмечен.
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export type RoleKey = 'dispatcher' | 'driver' | 'parent';

const ROWS: { role: RoleKey; to: string; label: string }[] = [
  { role: 'dispatcher', to: '/admin/inbox', label: 'Диспетчерская' },
  { role: 'driver', to: '/driver', label: 'Моя смена' },
  { role: 'parent', to: '/app', label: 'Как родитель' },
];

/** Показываем только тем, у кого больше одной роли. */
export function RoleRows({ current }: { current: RoleKey }) {
  const { me } = useAuth();
  if (!me?.roles.includes('dispatcher')) return null;
  const rows = ROWS.filter((r) => r.role !== 'driver' || me.roles.includes('driver'));
  return (
    <>
      <div className="section-label">Режим</div>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.role}>
            {r.role === current ? (
              <span className="list-row current" aria-current="page">
                <b>{r.label}</b>
                <small>сейчас</small>
              </span>
            ) : (
              <Link to={r.to} className="list-row">
                <b>{r.label}</b>
                <small>›</small>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
