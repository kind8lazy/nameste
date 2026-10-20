// Форматы ответов API — общие для сервера и веб-приложения.
import type { RideStatus, Role, Tone, Escort } from './domain';

export interface Me {
  id: string;
  name: string;
  roles: Role[];
  families: { id: string; name: string; relation: string; canEdit: boolean }[];
  pushEnabled: boolean;
  yandexLinked: boolean;
  /** Простой режим: карта, слежение, цены и ссылки для близких скрыты. */
  lite: boolean;
}

export interface PlaceView {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  entranceNote: string | null;
  contactPhone: string | null;
}

export interface ChildView {
  id: string;
  firstName: string;
  grade: string | null;
  photoUrl: string | null;
  color: string;
  seat: 'none' | 'booster' | 'seat';
  notes: string | null;
  handoverTo: string[];
}

export interface DriverView {
  name: string;
  phone: string | null;
  vehicle: string | null;
  plate: string | null;
}

export interface RideView {
  id: string;
  date: string;
  familyId: string;
  child: ChildView;
  from: PlaceView;
  to: PlaceView;
  pickupTime: string;
  arriveBy: string | null;
  escort: Escort;
  priceRub: number;
  status: RideStatus;
  statusLabel: string;
  step: number;
  tone: Tone;
  runId: string | null;
  pickupStopId: string | null;
  dropoffStopId: string | null;
  /** HH:MM — ожидаемое время у точки забора или высадки */
  eta: string | null;
  plannedDropoff: string | null;
  times: { departed?: string; arrived?: string; boarded?: string; delivered?: string };
  receiver: string | null;
  cancelReason: string | null;
  driver: DriverView | null;
}

export interface Position {
  lat: number;
  lon: number;
  at: number;
  heading?: number | null;
}

export interface ParentDay {
  date: string;
  dayLabel: string;
  children: ChildView[];
  rides: RideView[];
  /** координаты машины — только пока ребёнок этой семьи в активной поездке */
  live: { runId: string; position: Position | null } | null;
}

export interface WeekDay {
  date: string;
  dayLabel: string;
  rides: RideView[];
}

export interface StopView {
  id: string;
  seq: number;
  kind: 'pickup' | 'dropoff';
  plannedAt: string;
  place: PlaceView;
  departedAt: string | null;
  arrivedAt: string | null;
  doneAt: string | null;
  eta: string | null;
  rides: (RideView & { parentName: string | null; parentPhone: string | null })[];
}

export interface ShiftView {
  date: string;
  dayLabel: string;
  run: { id: string; status: 'planned' | 'active' | 'done'; vehicle: string | null; plate: string | null } | null;
  stops: StopView[];
  trackerHint: { url: string; deviceId: string } | null;
}

export interface AdminDay {
  date: string;
  dayLabel: string;
  runs: (ShiftView['run'] & { driverName: string; stops: StopView[] })[];
  unassigned: RideView[];
  positions: Record<string, Position>;
  stats: { rides: number; children: number; revenueRub: number; paidKm: number; emptyKm: number };
}

// ——— сообщения ———
export interface ChatThread {
  id: string;
  title: string;
  unread: number;
  last: { body: string; at: string; authorName: string } | null;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  mine: boolean;
  body: string;
  createdAt: string;
}
