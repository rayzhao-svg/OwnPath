"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="standalone-state">
      <span className="eyebrow">A SMALL DETOUR</span>
      <h1>Let’s try that again.</h1>
      <p>Your page couldn’t load. Refresh the view to continue.</p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
