"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icon";
import { useAccount } from "@/lib/account-context";
import { useLearning } from "@/lib/learning-context";
import styles from "./account-panel.module.css";

type AccountAction = "register" | "login" | "logout" | "import" | "sync";

export function AccountPanel() {
  const { user, status, error: accountError, register, login } = useAccount();
  const { guestTrackCount, importGuestTracks, logoutAccount, syncStatus, syncError, retrySync } = useLearning();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [fields, setFields] = useState({ name: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<AccountAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);

  useEffect(() => () => { generation.current++; }, []);

  async function act(action: AccountAction, operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    const requestGeneration = generation.current;
    setBusy(action);
    setError(null);
    try {
      await operation();
      if (requestGeneration !== generation.current) return;
      if (action === "register" || action === "login" || action === "logout") {
        setFields((current) => ({ ...current, password: "" }));
        setShowPassword(false);
      }
      if (action === "logout") setMode("login");
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Your account could not be updated. Please try again.");
    } finally {
      if (requestGeneration === generation.current) {
        pending.current = false;
        setBusy(null);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const name = fields.name.trim();
    const email = fields.email.trim();
    if ((mode === "register" && !name) || !email || fields.password.length < 12 || fields.password.length > 128) {
      setError("Enter your email and a password of 12–128 characters, plus your name when creating an account.");
      return;
    }
    if (mode === "register") void act("register", () => register({ name, email, password: fields.password }));
    else void act("login", () => login({ email, password: fields.password }));
  }

  const displayedError = error || accountError;
  const saving = syncStatus === "syncing";
  const syncMessage = saving ? "Saving your learning tracks and progress…"
    : syncStatus === "error" ? syncError || "Your latest changes could not be saved to your account. Try saving again."
    : syncStatus === "saved" ? "Your learning tracks and progress are saved to your account."
    : "Your learning tracks and progress will be saved to this account.";

  return (
    <div className={styles.layout}>
      <div className={styles.intro}>
        <span className="eyebrow">YOUR LEARNING, KEPT TOGETHER</span>
        <h1>{user ? "Every path has a place." : "A place for every path."}</h1>
        <p>{user
          ? "Keep your learning goals together while giving each track its own lessons and progress. Pick up where you left off, one step at a time."
          : "Create an account to save your learning tracks and progress. Already started as a guest? You can choose to add that learning after you sign in."}</p>
        <ul className={styles.benefits}>
          <li><Icon name="layers" size={18} /><span>Separate tracks for different learning goals.</span></li>
          <li><Icon name="book" size={18} /><span>Saved lessons, quizzes, and progress in one place.</span></li>
          <li><Icon name="leaf" size={18} /><span>Your choice about when to add guest learning.</span></li>
        </ul>
      </div>

      <section className={styles.panel} aria-labelledby="account-panel-title" aria-busy={!!busy || status === "loading"}>
        {status === "loading" ? <>
          <h2 id="account-panel-title">Opening your account</h2>
          <p className={styles.loading} role="status">Checking your sign-in…</p>
        </> : user ? <>
          <span className="eyebrow">YOU’RE SIGNED IN</span>
          <h2 id="account-panel-title">Your account</h2>
          <p>Your account details and saved learning.</p>
          <dl className={styles.accountDetails}>
            <div><dt>Name</dt><dd>{user.name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
          </dl>
          <div className={styles.syncStatus} role="status">
            <Icon name={syncStatus === "saved" ? "check" : "layers"} size={17} />
            <span>{syncMessage}</span>
          </div>
          {syncStatus === "error" && <button type="button" className="button button-secondary button-small" disabled={!!busy} onClick={() => { void act("sync", retrySync); }}>
            {busy === "sync" ? "Saving again…" : "Try saving again"}
          </button>}
          {guestTrackCount > 0 && <div className={styles.finePrint}>
            <p>{guestTrackCount} {guestTrackCount === 1 ? "guest track is" : "guest tracks are"} available from this browser. Import this browser’s saved tracks into this account. Your existing account tracks are kept.</p>
            <button type="button" className={`button button-secondary button-small ${styles.importButton}`} disabled={!!busy || saving} onClick={() => { void act("import", importGuestTracks); }}>
              {busy === "import" ? "Saving guest tracks…" : "Save this browser’s guest tracks to my account"}
            </button>
          </div>}
          {displayedError && <p className="form-error" role="alert">{displayedError}</p>}
          <div className={`${styles.accountActions} ${styles.finePrint}`}>
            <Link href="/dashboard" className="button button-primary">Go to my learning <Icon name="arrow-right" size={16} /></Link>
            <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => { void act("logout", logoutAccount); }}>
              {busy === "logout" ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </> : <>
          <div className={styles.switcher} role="group" aria-label="Account options">
            <button type="button" aria-pressed={mode === "register"} disabled={!!busy} onClick={() => { setMode("register"); setError(null); }}>Create account</button>
            <button type="button" aria-pressed={mode === "login"} disabled={!!busy} onClick={() => { setMode("login"); setError(null); }}>Sign in</button>
          </div>
          <h2 id="account-panel-title">{mode === "register" ? "Make yourself at home." : "Welcome back."}</h2>
          <p>{mode === "register" ? "A few details, and your learning has a home." : "Sign in to return to your saved learning."}</p>
          <form method="post" className={styles.form} onSubmit={submit} aria-describedby={displayedError ? "account-form-error" : undefined}>
            {mode === "register" && <div className={styles.field}>
              <label htmlFor="account-name">Name</label>
              <input id="account-name" name="name" autoComplete="name" required maxLength={100} value={fields.name} disabled={!!busy} onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))} />
            </div>}
            <div className={styles.field}>
              <label htmlFor="account-email">Email</label>
              <input id="account-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} value={fields.email} disabled={!!busy} onChange={(event) => setFields((current) => ({ ...current, email: event.target.value }))} />
            </div>
            <div className={styles.field}>
              <label htmlFor="account-password">Password</label>
              <input id="account-password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={12} maxLength={128} aria-describedby="account-password-help" value={fields.password} disabled={!!busy} onChange={(event) => setFields((current) => ({ ...current, password: event.target.value }))} />
              <small id="account-password-help">Use 12–128 characters. Spaces are welcome.</small>
            </div>
            <label className={styles.passwordToggle}><input type="checkbox" checked={showPassword} disabled={!!busy} onChange={(event) => setShowPassword(event.target.checked)} /> Show password</label>
            {displayedError && <p id="account-form-error" className="form-error" role="alert">{displayedError}</p>}
            <button className={`button button-primary ${styles.submit}`} type="submit" disabled={!!busy}>
              {busy === "register" ? "Creating your account…" : busy === "login" ? "Signing in…" : mode === "register" ? "Create my account" : "Sign in"}
              {!busy && <Icon name="arrow-right" size={17} />}
            </button>
          </form>
          <p className={styles.finePrint}>Guest learning stays in this browser until you choose to save it to an account. You can also <Link href="/dashboard">continue learning as a guest</Link>.</p>
        </>}
      </section>
    </div>
  );
}
