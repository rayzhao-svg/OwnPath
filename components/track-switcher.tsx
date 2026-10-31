"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useLearning } from "@/lib/learning-context";
import styles from "./track-switcher.module.css";

const TRACK_LABELS = {
  "data-science": "Data science",
  "web-development": "Web development",
  "product-design": "Product design",
};

export function TrackSwitcher() {
  const { paths, activePathId, switchPath, newPath, deletePath, ready, syncStatus } = useLearning();
  const router = useRouter();
  const [busy, setBusy] = useState<"switch" | "new" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  async function act(action: "switch" | "new" | "delete", operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    const requestGeneration = generation.current;
    setBusy(action);
    if (action !== "delete") setConfirmDelete(null);
    setError(null);
    try {
      await operation();
      if (requestGeneration === generation.current) setConfirmDelete(null);
    } catch (cause) {
      if (requestGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "Your learning tracks could not be updated. Please try again.");
    } finally {
      if (requestGeneration === generation.current) {
        pending.current = false;
        setBusy(null);
      }
    }
  }

  const selected = paths.find((path) => path.id === activePathId);
  const deleting = paths.find((path) => path.id === confirmDelete);
  const recentPaths = [...paths].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 6);

  return <section className={styles.panel} aria-label="Your learning tracks" aria-busy={!!busy || !ready}>
    <div className={styles.heading}>
      <div><span className="eyebrow">YOUR LEARNING TRACKS</span><h2>Different goals, one learning space.</h2></div>
      <button type="button" className="button button-secondary button-small" disabled={!ready || !!busy} onClick={() => {
        void act("new", async () => { await newPath(); router.push("/onboarding"); });
      }}><Icon name="plus" size={16} /> New learning track</button>
    </div>
    {!ready ? <p className={styles.note} role="status">Opening your saved tracks…</p>
      : paths.length ? <>
      <div className={styles.pathCards} role="group" aria-label="Recent learning tracks">
        {recentPaths.map((path) => <button type="button" key={path.id} className={styles.pathCard}
          aria-pressed={path.id === activePathId} disabled={!!busy} onClick={() => {
            if (path.id !== activePathId) void act("switch", () => switchPath(path.id));
          }}>
          <span className={styles.pathCardTop}><span>{TRACK_LABELS[path.track]}</span>{path.id === activePathId && <span className={styles.currentBadge}><Icon name="check" size={11} /> Current</span>}</span>
          <strong>{path.title}</strong>
          <span className={styles.pathProgress} aria-hidden="true"><span style={{ width: `${Math.min(100, path.completedModuleCount / Math.max(1, path.moduleCount) * 100)}%` }} /></span>
          <span className={styles.pathCompletion}>{`${path.completedModuleCount}/${path.moduleCount} complete`}</span>
        </button>)}
      </div>
      <div className={styles.controls}>
        <div className={styles.selector}>
          <label htmlFor="learning-track-selector">Active learning track</label>
          <select id="learning-track-selector" value={activePathId ?? ""} disabled={!!busy} onChange={(event) => {
            const id = event.target.value;
            if (id && id !== activePathId) void act("switch", () => switchPath(id));
          }}>
            <option value="" disabled>Choose a saved track</option>
            {paths.map((path, index) => <option key={path.id} value={path.id}>{index + 1}. {path.title} · {TRACK_LABELS[path.track]} · {path.completedModuleCount}/{path.moduleCount} complete</option>)}
          </select>
        </div>
        <div className={styles.meta}>
          <span>{paths.length} saved {paths.length === 1 ? "track" : "tracks"}{selected ? ` · ${selected.completedModuleCount} of ${selected.moduleCount} modules complete` : ""}</span>
          {selected && <button type="button" className={styles.deleteLink} disabled={!!busy} onClick={() => { setConfirmDelete(selected.id); setError(null); }}>Delete this track</button>}
        </div>
      </div></> : <p className={styles.note}>Start a learning track for each goal. Your existing tracks stay here when you create another.</p>}
    {deleting && <div className={styles.confirmation} role="alert">
      <p>Delete “{deleting.title}”? Its saved lessons, quiz attempts, and progress will be removed.</p>
      <div><button type="button" className={styles.deleteButton} disabled={!!busy} onClick={() => { void act("delete", () => deletePath(deleting.id)); }}>{busy === "delete" ? "Deleting…" : "Delete track"}</button>
        <button type="button" className="button button-secondary button-small" disabled={!!busy} onClick={() => setConfirmDelete(null)}>Keep track</button></div>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {ready && syncStatus === "syncing" && <p className={styles.note} role="status">Saving your latest progress…</p>}
  </section>;
}
