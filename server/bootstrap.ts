// Боевой старт с пустой базой: создаёт диспетчера-водителя и машину, печатает код первого входа.
// Запуск: npm run bootstrap -- "Дмитрий" "+7 900 000-00-00" "Kia Carnival" "А123ВС178"
// Демо-данных не создаёт. Если в базе уже есть люди — ничего не делает.
import { db, schema, runMigrations } from './db/client';
import { newId, newToken } from './lib/ids';
import { createLoginCode } from './modules/auth';

runMigrations();
const [name = 'Диспетчер', phone = '', car = 'Машина 1', plate = '—'] = process.argv.slice(2);
if (db.select().from(schema.users).all().length) {
  console.log('В базе уже есть пользователи — ничего не меняю. Для чистого старта удалите файл базы в data/.');
  process.exit(0);
}
const userId = newId('u');
const vehicleId = newId('veh');
db.insert(schema.users).values({ id: userId, name, phone: phone || null, roles: ['driver', 'dispatcher'] }).run();
db.insert(schema.vehicles).values({ id: vehicleId, title: car, plate, seats: 7 }).run();
db.insert(schema.drivers).values({ userId, vehicleId, trackerToken: newToken(12) }).run();
const { code } = createLoginCode(userId, 'invite');
console.log(`Готово. ${name} — диспетчер и водитель, машина: ${car}.\nКод первого входа (3 дня): ${code}\nПосле входа привяжите Яндекс в приложении, чтобы входить одной кнопкой.`);
