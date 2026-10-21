// Схема базы. SQLite на старте (ноль администрирования, резервная копия — копия файла).
// Запросы идут через Drizzle ORM, поэтому переезд на PostgreSQL — смена диалекта, а не переписывание логики.
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import type { Role, RideStatus, RideEventType, EventSource, Escort } from '../../shared/domain';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export interface NotifyPrefs {
  /** какие события получать: 'all' — всё, 'key' — в машине, передан, проблемы, 'handover' — только передан */
  level: 'all' | 'key' | 'handover';
}

// ——— люди и доступ ———

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'), // почта из Яндекс ID или записанная диспетчером — на неё уходят письма
  roles: text('roles', { mode: 'json' }).$type<Role[]>().notNull(),
  yandexId: text('yandex_id').unique(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

/** Коды входа: приглашение от диспетчера (7 дней) или перенос входа на другое устройство (10 минут). */
export const loginCodes = sqliteTable('login_codes', {
  code: text('code').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'invite' | 'device'>().notNull(),
  createdBy: text('created_by'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  uses: integer('uses').notNull().default(0),
  maxUses: integer('max_uses').notNull().default(5),
  createdAt: createdAt(),
});

// ——— семьи, дети, места ———

export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  note: text('note'),
  createdAt: createdAt(),
});

export const familyMembers = sqliteTable(
  'family_members',
  {
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    relation: text('relation').notNull(), // «мама», «папа», «бабушка»
    isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
    canEdit: integer('can_edit', { mode: 'boolean' }).notNull().default(false),
    notify: text('notify', { mode: 'json' }).$type<NotifyPrefs>().notNull().$defaultFn(() => ({ level: 'all' })),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.userId] }), index('members_user').on(t.userId)],
);

export const children = sqliteTable(
  'children',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    birthDate: text('birth_date'),
    grade: text('grade'), // «3 кл.»
    photoUrl: text('photo_url'),
    seat: text('seat').$type<'none' | 'booster' | 'seat'>().notNull().default('none'),
    notes: text('notes'),
    /** кому можно передавать ребёнка кроме родителей */
    handoverTo: text('handover_to', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    codeWord: text('code_word'),
    lestartStudentId: text('lestart_student_id'),
    color: text('color'), // цвет аватара, если нет фото
    createdAt: createdAt(),
  },
  (t) => [index('children_family').on(t.familyId)],
);

export const places = sqliteTable('places', {
  id: text('id').primaryKey(),
  /** null — общее место (школа, секция), видно всем семьям */
  familyId: text('family_id').references(() => families.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address').notNull(),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  entranceNote: text('entrance_note'), // «вход со двора, 2 этаж, кабинет 12»
  radiusM: integer('radius_m').notNull().default(150),
  contactPhone: text('contact_phone'),
  createdAt: createdAt(),
});

// ——— машины и водители ———

export const vehicles = sqliteTable('vehicles', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  plate: text('plate').notNull(),
  seats: integer('seats').notNull(),
  boosters: integer('boosters').notNull().default(0),
  childSeats: integer('child_seats').notNull().default(0),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
  note: text('note'), // «в ремонте до 12 октября»
  createdAt: createdAt(),
});

export const drivers = sqliteTable('drivers', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  vehicleId: text('vehicle_id').references(() => vehicles.id),
  /** секрет для приложения-трекера (Traccar Client), по нему принимаем координаты */
  trackerToken: text('tracker_token').notNull().unique(),
  bio: text('bio'),
  photoUrl: text('photo_url'),
});

// ——— расписание ———

export const rideTemplates = sqliteTable(
  'ride_templates',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    childId: text('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    fromPlaceId: text('from_place_id')
      .notNull()
      .references(() => places.id),
    toPlaceId: text('to_place_id')
      .notNull()
      .references(() => places.id),
    time: text('time').notNull(), // HH:MM — когда забрать
    arriveBy: text('arrive_by'), // HH:MM — к какому времени быть, если важно
    rule: text('rule').notNull(), // подмножество RRULE, см. shared/recurrence.ts
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    escort: text('escort').$type<Escort>().notNull().default('to_door'),
    priceRub: integer('price_rub').notNull(),
    /** кто возит; пусто — основной водитель */
    driverId: text('driver_id').references(() => users.id, { onDelete: 'set null' }),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('templates_family').on(t.familyId)],
);

export const templateExceptions = sqliteTable(
  'template_exceptions',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => rideTemplates.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    action: text('action').$type<'skip' | 'time'>().notNull(),
    time: text('time'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('exceptions_template_date').on(t.templateId, t.date)],
);

// ——— рейсы и поездки ———

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    driverId: text('driver_id')
      .notNull()
      .references(() => users.id),
    vehicleId: text('vehicle_id').references(() => vehicles.id),
    status: text('status').$type<'planned' | 'active' | 'done'>().notNull().default('planned'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('runs_date').on(t.date, t.driverId)],
);

export const stops = sqliteTable(
  'stops',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    placeId: text('place_id')
      .notNull()
      .references(() => places.id),
    kind: text('kind').$type<'pickup' | 'dropoff'>().notNull(),
    plannedAt: text('planned_at').notNull(), // HH:MM
    departedAt: integer('departed_at', { mode: 'timestamp_ms' }), // водитель выехал к этой точке
    arrivedAt: integer('arrived_at', { mode: 'timestamp_ms' }),
    doneAt: integer('done_at', { mode: 'timestamp_ms' }),
    etaAt: integer('eta_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('stops_run').on(t.runId, t.seq)],
);

export const rides = sqliteTable(
  'rides',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    childId: text('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    templateId: text('template_id').references(() => rideTemplates.id, { onDelete: 'set null' }),
    date: text('date').notNull(),
    fromPlaceId: text('from_place_id')
      .notNull()
      .references(() => places.id),
    toPlaceId: text('to_place_id')
      .notNull()
      .references(() => places.id),
    pickupTime: text('pickup_time').notNull(),
    arriveBy: text('arrive_by'),
    escort: text('escort').$type<Escort>().notNull().default('to_door'),
    priceRub: integer('price_rub').notNull(),
    status: text('status').$type<RideStatus>().notNull().default('planned'),
    /** кто везёт; пусто — основной водитель */
    driverId: text('driver_id').references(() => users.id, { onDelete: 'set null' }),
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    pickupStopId: text('pickup_stop_id').references(() => stops.id, { onDelete: 'set null' }),
    dropoffStopId: text('dropoff_stop_id').references(() => stops.id, { onDelete: 'set null' }),
    receiver: text('receiver'),
    cancelReason: text('cancel_reason'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('rides_template_date').on(t.templateId, t.date),
    index('rides_date').on(t.date),
    index('rides_family_date').on(t.familyId, t.date),
    index('rides_run').on(t.runId),
  ],
);

/** Журнал поездки: только добавление. Из него строятся уведомления, отчёт и разбор спорных случаев. */
export const rideEvents = sqliteTable(
  'ride_events',
  {
    id: text('id').primaryKey(),
    rideId: text('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    type: text('type').$type<RideEventType>().notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    actorUserId: text('actor_user_id'),
    source: text('source').$type<EventSource>().notNull(),
    lat: real('lat'),
    lon: real('lon'),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [index('events_ride').on(t.rideId, t.at)],
);

// ——— геопозиция ———

export const positions = sqliteTable(
  'positions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    driverId: text('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    speed: real('speed'),
    heading: real('heading'),
    accuracy: real('accuracy'),
    battery: real('battery'),
    source: text('source').$type<'app' | 'tracker'>().notNull(),
  },
  (t) => [index('positions_driver_at').on(t.driverId, t.at)],
);

// ——— уведомления ———

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  failures: integer('failures').notNull().default(0),
  lastOkAt: integer('last_ok_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
});

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rideId: text('ride_id'),
    kind: text('kind').notNull(),
    channel: text('channel').$type<'webpush' | 'sms' | 'email'>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status').$type<'sent' | 'failed' | 'no_device'>().notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user').on(t.userId, t.createdAt)],
);

/** Служебные значения: когда последний раз слали напоминания и т. п. */
export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Заявка родителя на новую поездку или маршрут. Диспетчер принимает — появляются шаблоны недели. */
export const rideRequests = sqliteTable(
  'ride_requests',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    childIds: text('child_ids', { mode: 'json' }).$type<string[]>().notNull(),
    fromPlaceId: text('from_place_id').references(() => places.id),
    fromAddress: text('from_address'), // новый адрес словами, если места ещё нет
    toPlaceId: text('to_place_id').references(() => places.id),
    toAddress: text('to_address'),
    time: text('time').notNull(),
    rule: text('rule').notNull(),
    startDate: text('start_date').notNull(),
    escort: text('escort').$type<Escort>().notNull().default('to_door'),
    comment: text('comment'),
    priceRub: integer('price_rub').notNull(),
    status: text('status').$type<'new' | 'accepted' | 'declined'>().notNull().default('new'),
    answer: text('answer'),
    createdAt: createdAt(),
  },
  (t) => [index('requests_family').on(t.familyId), index('requests_status').on(t.status)],
);

/** Ссылка отслеживания для бабушки, папы и всех, у кого нет приложения. Работает один день. */
export const trackLinks = sqliteTable(
  'track_links',
  {
    token: text('token').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    createdBy: text('created_by'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('track_links_family').on(t.familyId, t.date)],
);

// ——— сообщения: чат семьи с диспетчером и водителем, чат команды ———

/** thread: «family:<id семьи>» — семья, диспетчеры и водители; «team» — диспетчеры и водители. */
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    thread: text('thread').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('messages_thread_idx').on(t.thread, t.createdAt)],
);

export const chatReads = sqliteTable(
  'chat_reads',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    thread: text('thread').notNull(),
    readAt: integer('read_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.thread] })],
);
