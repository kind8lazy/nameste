// Плитки главных экранов (как у LeStart): раздел, живая подпись, переход. Общие для всех ролей.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Tile({
  title,
  sub,
  icon,
  to,
  onClick,
  accent,
}: {
  title: string;
  sub: string;
  icon: ReactNode;
  to?: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  const body = (
    <>
      <span className="tile-icon">{icon}</span>
      <span className="tile-text">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      <span className="tile-chevron" aria-hidden>
        ›
      </span>
    </>
  );
  const cls = `tile${accent ? " accent" : ""}`;
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  );
}

const svg = (d: ReactNode) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {d}
  </svg>
);
export const IconCar = () =>
  svg(
    <>
      <path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16" />
      <rect x="3" y="16" width="18" height="4" rx="1.5" />
      <circle cx="7.5" cy="20" r="1" />
      <circle cx="16.5" cy="20" r="1" />
    </>,
  );
export const IconCalendar = () =>
  svg(
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>,
  );
export const IconPause = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 9v6M14 9v6" />
    </>,
  );
export const IconPlus = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>,
  );
export const IconClock = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
  );
export const IconChat = () =>
  svg(
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V16h0A2.5 2.5 0 0 1 4 13.5z" />,
  );
export const IconRoute = () =>
  svg(
    <>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
    </>,
  );
export const IconUsers = () =>
  svg(
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 6M17.5 14a5 5 0 0 1 3 5" />
    </>,
  );
export const IconInbox = () =>
  svg(
    <>
      <path d="M4 13l2.5-7.5h11L20 13v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" />
      <path d="M4 13h4.5l1 2h5l1-2H20" />
    </>,
  );
