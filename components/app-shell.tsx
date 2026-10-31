"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";
import { ClaudeCredit } from "@/components/claude-credit";
import { Icon } from "@/components/icon";
import { useLearning } from "@/lib/learning-context";
import { useAccount } from "@/lib/account-context";

export function AppShell({
  children,
  active,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  active: "dashboard" | "learn" | "onboarding" | "account";
  eyebrow?: string;
  title?: string;
}) {
  const { state, storageWarning, syncStatus, syncError } = useLearning();
  const { user } = useAccount();
  const completed =
    state.plan?.modules.filter((m) => m.status === "completed").length || 0;
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <Brand small />
          <ClaudeCredit />
        </div>
        <div className="workspace-label">YOUR LEARNING SPACE</div>
        <nav className="app-nav" aria-label="Main navigation">
          <Link
            href="/dashboard"
            className={
              active === "dashboard" || active === "learn" ? "active" : ""
            }
            aria-current={active === "dashboard" ? "page" : undefined}
          >
            <Icon name="layers" />
            My learning paths
            <Icon className="nav-arrow" name="chevron-right" size={15} />
          </Link>
          <Link
            href="/onboarding"
            className={active === "onboarding" ? "active" : ""}
            aria-current={active === "onboarding" ? "page" : undefined}
          >
            <Icon name="target" />
            Learner profile
          </Link>
          <Link href="/">
            <Icon name="home" />
            Discover OwnPath
          </Link>
          <Link href="/account" className={active === "account" ? "active" : ""} aria-current={active === "account" ? "page" : undefined}>
            <Icon name="target" />{user ? "My account" : "Sign in / Create account"}
          </Link>
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <Icon name="leaf" size={23} />
          </span>
          <h3>A little, every day.</h3>
          <p>Big goals grow from small moments of learning.</p>
          <div className="sidebar-note-line" />
          <span>{completed} modules completed</span>
        </div>
        <div className="sidebar-footer">
          <span className="profile-avatar">
            {(state.profile?.name || user?.name || "L").charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{state.profile?.name || user?.name || "Your next chapter"}</strong>
            <small>
              {state.profile
                ? user ? syncStatus === "syncing" ? "Saving to your account…" : "Account learning space" : "Saved in this browser"
                : user ? "Signed in" : "Make yourself at home"}
            </small>
          </div>
        </div>
      </aside>
      <div className="app-main-wrap">
        <header className="app-topbar">
          <div>
            <span className="topbar-label">
              {eyebrow || "Your learning, your way"}
            </span>
            {title && <span className="topbar-title">{title}</span>}
          </div>
          <span className="mock-badge">
            <span /> {state.planMode === "claude"
              ? "Claude curriculum"
              : state.planMode === "mock"
                ? "Mock curriculum"
                : "Your personal learning space"}
          </span>
        </header>
        <main id="main-content" className="app-content">
          {storageWarning && (
            <div className="storage-warning" role="status">
              {storageWarning}
            </div>
          )}
          {syncError && <div className="storage-warning" role="status">{syncError} <Link href="/account">Manage saved progress</Link></div>}
          {children}
        </main>
        <footer className="app-footer">
          <span>Built around you. One step at a time.</span>
          <span>OwnPath · Your curiosity belongs here.</span>
        </footer>
      </div>
    </div>
  );
}
