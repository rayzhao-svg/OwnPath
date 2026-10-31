import Link from "next/link";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${small ? "brand-small" : ""}`}
      aria-label="OwnPath home"
    >
      <svg
        width="31"
        height="35"
        viewBox="0 0 31 35"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 30V16C4 7 11 3 16 3v15c0 8-5 12-12 12Z"
          fill="currentColor"
        />
        <path
          d="M19 31V20c0-7 4-11 9-11v10c0 7-3 11-9 12Z"
          fill="currentColor"
          opacity=".55"
        />
      </svg>
      <span>
        ownpath<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
