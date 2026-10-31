import type { Metadata } from "next";
import Link from "next/link";
import { AccountPanel } from "@/components/account-panel";
import { AppShell } from "@/components/app-shell";
import { accountsAvailable } from "@/lib/account-availability";
import styles from "@/components/account-panel.module.css";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  if (!accountsAvailable()) {
    return (
      <AppShell active="account" eyebrow="Your learning, your way" title="Guest learning">
        <section className={styles.panel} aria-labelledby="guest-learning-title">
          <span className="eyebrow">MAKE YOUR NEXT CHAPTER</span>
          <h1 id="guest-learning-title">Keep learning as a guest.</h1>
          <p>This site supports guest learning. Your paths, lessons, quizzes, and progress are saved in this browser on this device.</p>
          <p>Accounts and cross-device sync are unavailable here. Clearing browser storage removes guest progress.</p>
          <div className={styles.accountActions}>
            <Link href="/onboarding" className="button button-primary">Create a learning path</Link>
            <Link href="/dashboard" className="button button-secondary">My learning paths</Link>
          </div>
        </section>
      </AppShell>
    );
  }
  return <AppShell active="account" eyebrow="A home for your progress" title="Your account"><AccountPanel /></AppShell>;
}
