// Главная водителя: смена сегодня, неделя вперёд, сообщения — плитками с живой подписью.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useStream } from "../../lib/stream";
import { useAuth } from "../../lib/auth";
import { useUnread } from "../../components/Chat";
import { Tile, IconCar, IconCalendar, IconChat } from "../../components/Tiles";
import type { ShiftView } from "@shared/api";
import { addDays, formatDayRu, localDate, localTime } from "@shared/time";
import { plural } from "@shared/ru";

const POINTS: [string, string, string] = ["точка", "точки", "точек"];

export function DriverHome() {
  const { me } = useAuth();
  const unread = useUnread();
  const [week, setWeek] = useState<ShiftView[] | null>(null);

  const load = useCallback(async () => {
    const today = localDate();
    setWeek(
      await Promise.all(
        Array.from({ length: 7 }, (_, i) =>
          api.get<ShiftView>(`/driver/shift?date=${addDays(today, i)}`),
        ),
      ),
    );
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("theme-driver");
    document.body.classList.add("theme-driver");
    void load();
    return () => {
      document.documentElement.classList.remove("theme-driver");
      document.body.classList.remove("theme-driver");
    };
  }, [load]);
  useStream({ rides: () => void load(), refresh: () => void load() });

  if (!week)
    return (
      <main className="page">
        <div className="empty">Загрузка…</div>
      </main>
    );

  const [today, ...rest] = week;
  const now = localTime();
  const left = today.stops.filter(
    (s) => !s.doneAt && s.rides.some((r) => r.status !== "cancelled"),
  );
  const next = left[0];
  const todayText = !today.run
    ? "Сегодня смены нет"
    : !left.length
      ? "Все точки пройдены"
      : `${left.length} ${plural(left.length, POINTS)} · ${today.run.status === "active" ? "сейчас" : next.plannedAt >= now ? "первая в" : "следующая"} ${next.plannedAt} ${next.kind === "pickup" ? "забрать" : "высадить"} · ${next.place.name}`;
  const days = rest.filter((d) => d.run && d.stops.length);
  const nextDay = days[0];
  const weekText = days.length
    ? `${days.length} ${plural(days.length, ["смена", "смены", "смен"])} · дальше ${formatDayRu(nextDay.date)} в ${nextDay.stops[0].plannedAt}`
    : "На неделе смен больше нет";

  return (
    <div className="app theme-driver">
      <main className="page">
        <div className="page-head">
          <h1 className="page-title">{me?.name}</h1>
          <span className="page-sub">{today.dayLabel}</span>
        </div>
        {today.run && (
          <div className="page-sub">
            {[today.run.vehicle, today.run.plate].filter(Boolean).join(" · ")}
          </div>
        )}
        <nav className="tiles" aria-label="Разделы">
          <Tile
            to="/driver/shift"
            title="Смена сегодня"
            sub={todayText}
            accent={
              today.run?.status === "active" ||
              (!!next && next.plannedAt <= now)
            }
            icon={<IconCar />}
          />
          <Tile
            to={
              nextDay ? `/driver/shift?date=${nextDay.date}` : "/driver/shift"
            }
            title="Неделя"
            sub={weekText}
            icon={<IconCalendar />}
          />
          <Tile
            to="/driver/chat"
            title="Сообщения"
            sub={
              unread
                ? `${unread} ${plural(unread, ["новое", "новых", "новых"])}`
                : "Диспетчер и семьи"
            }
            accent={unread > 0}
            icon={<IconChat />}
          />
        </nav>
      </main>
    </div>
  );
}
