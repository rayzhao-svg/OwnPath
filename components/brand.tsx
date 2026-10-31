import Link from "next/link";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${small ? "brand-small" : ""}`}
      aria-label="OwnPath home"
    >
      <svg
        width="34"
        height="38"
        viewBox="0 0 36 40"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M18 24v13m-4.5 0h9"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <path
          d="M18 2.5c-5 0-9 3.9-9.1 8.8A8.1 8.1 0 0 0 3 19.1c0 4.5 3.6 8.1 8.1 8.1h13.8c4.5 0 8.1-3.6 8.1-8.1 0-3.7-2.5-6.8-5.9-7.8C27 6.4 23 2.5 18 2.5Z"
          fill="currentColor"
        />
        <path
          d="M18 26V12m0 10-6-5m6 1.5 5-4.5"
          stroke="var(--paper)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity=".75"
        />
      </svg>
      <span>
        ownpath<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
