// Демо-данные: одна семья (Маша и Лёва), водитель-диспетчер, машина и неделя поездок.
// Запуск: npm run seed  (стирает базу в data/ и создаёт заново)
import fs from 'node:fs';
import { config } from './config';

const dbFile = config.dbFile;
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);

const { db, schema, runMigrations } = await import('./db/client');
const { newId, newToken } = await import('./lib/ids');
const { createLoginCode } = await import('./modules/auth');
const { materialize } = await import('./modules/schedule');
const { planDay } = await import('./modules/planner');
const { localDate, addDays, weekStart } = await import('../shared/time');

runMigrations();

const driverId = newId('u');
const vehicleId = newId('veh');
db.insert(schema.users).values({ id: driverId, name: 'Дмитрий', phone: '+7 900 000-00-00', roles: ['driver', 'dispatcher'] }).run();
db.insert(schema.vehicles).values({ id: vehicleId, title: 'Kia Carnival', plate: 'А 123 ВС 178', seats: 7, boosters: 1, childSeats: 1 }).run();
db.insert(schema.vehicles).values({ id: newId('veh'), title: 'Машина 2', plate: '—', seats: 5, available: false, note: 'в ремонте' }).run();
db.insert(schema.drivers).values({ userId: driverId, vehicleId, trackerToken: newToken(12), bio: 'Основатель «Острова детства», отец четырёх детей' }).run();

const familyId = newId('fam');
const momId = newId('u');
const granId = newId('u');
db.insert(schema.families).values({ id: familyId, name: 'Демо-семья', note: 'Пример для проверки' }).run();
db.insert(schema.users).values({ id: momId, name: 'Мама (демо)', phone: '+7 900 000-00-01', roles: ['parent'] }).run();
db.insert(schema.users).values({ id: granId, name: 'Бабушка (демо)', roles: ['parent'] }).run();
db.insert(schema.familyMembers).values({ familyId, userId: momId, relation: 'мама', isOwner: true, canEdit: true }).run();
db.insert(schema.familyMembers).values({ familyId, userId: granId, relation: 'бабушка', notify: { level: 'handover' } }).run();

const masha = newId('ch');
const leva = newId('ch');
db.insert(schema.children)
  .values({ id: masha, familyId, firstName: 'Маша', grade: '3 кл.', color: '#B97A5B', notes: 'Передавать тренеру лично', handoverTo: ['тренер', 'бабушка'] })
  .run();
db.insert(schema.children)
  .values({ id: leva, familyId, firstName: 'Лёва', grade: '2 кл.', color: '#5D7F8E', seat: 'booster', handoverTo: ['бабушка'] })
  .run();

// Координаты примерные, для демонстрации
const place = (name: string, address: string, lat: number, lon: number, entranceNote?: string, familyOnly = false) => {
  const id = newId('pl');
  db.insert(schema.places).values({ id, familyId, name, address, lat, lon, entranceNote }).run();
  return id;
};
const home = place('Дом', 'Петровский пр., Петровский остров', 59.9608, 30.2705, 'Код подъезда — в карточке семьи', true);
const school = place('Школа', 'пр. Динамо, Крестовский остров', 59.9695, 30.27, 'Главный вход, педагог ГПД выводит детей');
const tennis = place('Теннис', 'наб. Большой Невки, Каменный остров', 59.98, 30.3, 'Вход со двора, раздевалка слева');
const music = place('Музыкалка', 'Каменноостровский пр., Петроградская сторона', 59.9537, 30.3253, '2 этаж, кабинет 12');

const start = weekStart(localDate());
const tpl = (childId: string, from: string, to: string, time: string, rule: string, priceRub: number) =>
  db.insert(schema.rideTemplates).values({ id: newId('tpl'), familyId, childId, fromPlaceId: from, toPlaceId: to, time, rule, startDate: start, priceRub }).run();

// Как в таблице «Маршрут водителя», только короче. Сегодняшний день недели включён всегда,
// чтобы демо работало в любой день.
const wd = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][(new Date().getDay() + 6) % 7];
const days = (...d: string[]) => `FREQ=WEEKLY;BYDAY=${[...new Set([...d, wd])].join(',')}`;
tpl(masha, school, tennis, '14:20', days('MO', 'TU', 'FR'), 1000);
tpl(leva, school, home, '14:20', days('MO', 'FR'), 700);
tpl(masha, tennis, music, '16:40', days('MO'), 1000);
tpl(masha, music, home, '20:00', days('MO'), 1000);
tpl(leva, home, tennis, '17:30', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE', 1000);

const created = materialize(localDate(), addDays(localDate(), 14));
planDay(localDate());
planDay(addDays(localDate(), 1));

db.insert(schema.kv).values({ key: 'demo_users', value: JSON.stringify({ parent: momId, grandma: granId, driver: driverId }) }).run();

const inv = (userId: string) => createLoginCode(userId, 'invite', driverId).code;
const driver = db.select().from(schema.drivers).all()[0];
console.log(`
Демо-данные готовы. Поездок создано: ${created}.

Коды входа (действуют 7 дней):
  Мама (родитель)          ${inv(momId)}
  Бабушка (только «передан») ${inv(granId)}
  Дмитрий (водитель и диспетчер) ${inv(driverId)}

Трекер для водителя (Traccar Client): идентификатор устройства ${driver.trackerToken}
`);
