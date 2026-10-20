// Аварийный вход: выдаёт код входа человеку прямо с сервера, если не работает ни Яндекс, ни приложение.
// Запуск: npm run invite -- "+7 921 000-00-00"   (телефон, почта или часть имени)
import { db, schema, runMigrations } from './db/client';
import { createLoginCode } from './modules/auth';
import { normalizePhone } from '../shared/phone';

runMigrations();
const q = (process.argv[2] ?? '').trim();
if (!q) {
  console.log('Укажите, кому выдать код: npm run invite -- "+7 921 000-00-00"');
  process.exit(1);
}
const phone = normalizePhone(q);
const users = db.select().from(schema.users).all();
const found = users.filter((u) => (phone && normalizePhone(u.phone) === phone) || u.email?.toLowerCase() === q.toLowerCase() || u.id === q || u.name.toLowerCase().includes(q.toLowerCase()));
if (!found.length) {
  console.log('Никого не нашёл. Все люди в базе:');
  users.forEach((u) => console.log(`  ${u.id}  ${u.name}  ${u.phone ?? ''}  ${u.email ?? ''}  ${u.roles.join(',')}`));
  process.exit(1);
}
for (const u of found) {
  const { code, expiresAt } = createLoginCode(u.id, 'invite');
  console.log(`${u.name} (${u.roles.join(', ')}${u.email ? `, ${u.email}` : ''}) — код ${code}, действует до ${expiresAt.toLocaleString('ru-RU')}`);
}
