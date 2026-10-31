import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main id="main-content" className="standalone-state">
      <Brand />
      <span className="eyebrow">A SMALL DETOUR · 404</span>
      <h1>Let’s find your way back.</h1>
      <p>This page isn’t part of your path.</p>
      <Link className="button button-primary" href="/dashboard">
        Back to my learning path
      </Link>
    </main>
  );
}
