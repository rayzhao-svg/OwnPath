import type { CSSProperties } from "react";

export type IconName =
  | "arrow-right"
  | "arrow-left"
  | "check"
  | "play"
  | "pause"
  | "volume"
  | "book"
  | "chat"
  | "clock"
  | "sparkles"
  | "chevron-right"
  | "refresh"
  | "lock"
  | "x"
  | "menu"
  | "target"
  | "layers"
  | "external"
  | "send"
  | "headphones"
  | "home"
  | "leaf"
  | "plus";
const paths: Record<IconName, React.ReactNode> = {
  "arrow-right": (
    <>
      <path d="M4 12h16M14 6l6 6-6 6" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M20 12H4m6-6-6 6 6 6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  play: <path d="m9 5 11 7-11 7Z" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  volume: (
    <>
      <path d="m11 5-6 4H2v6h3l6 4V5Z" />
      <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    </>
  ),
  book: (
    <>
      <path d="M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Zm0 0v15" />
    </>
  ),
  chat: (
    <path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-1l-5 2 1-5a9 9 0 1 1 17-5Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="M21 2v4m-2-2h4" />
    </>
  ),
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  refresh: (
    <>
      <path d="M20 7V3l-3 3a8 8 0 1 0 3 10M20 7h-5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" />
    </>
  ),
  x: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4L22 2Zm0 0L11 13" />
    </>
  ),
  headphones: (
    <>
      <path d="M3 14v-3a9 9 0 0 1 18 0v3" />
      <rect x="2" y="12" width="5" height="9" rx="2" />
      <rect x="17" y="12" width="5" height="9" rx="2" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v11H3V10Z" />
      <path d="M9 21v-8h6v8" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3C8 1 1 8 5 16c8 4 15-1 15-13Z" />
      <path d="m3 21 12-12" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

export function Icon({
  name,
  size = 20,
  className = "",
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
