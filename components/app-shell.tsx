"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icon";
import { useLearning } from "@/lib/learning-context";

export function AppShell({
  children,
  active,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  active: "dashboard" | "learn" | "onboarding";
  eyebrow?: string;
  title?: string;
}) {
  const { state, storageWarning } = useLearning();
  const completed =
    state.plan?.modules.filter((m) => m.status === "completed").length || 0;
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Brand small />
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
            My learning path
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
            {(state.profile?.name || "L").charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{state.profile?.name || "Your next chapter"}</strong>
            <small>
              {state.profile
                ? "Personal learning space"
                : "Make yourself at home"}
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
            <span /> Phase 1 · Mock mode
          </span>
        </header>
        <main id="main-content" className="app-content">
          {storageWarning && (
            <div className="storage-warning" role="status">
              {storageWarning}
            </div>
          )}
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
