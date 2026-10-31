"use client";

import { useEffect, useRef, useState } from "react";
import type { ResumeResult } from "@/lib/resume";
import styles from "./resume-upload.module.css";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LENGTH = 16000;

type ResumeUploadProps = {
  disabled: boolean;
  onExtracted: (result: ResumeResult) => void;
  onBusyChange: (busy: boolean) => void;
};

// Validate the network boundary before any provider-derived strings reach the form.
function isResumeResult(value: unknown): value is ResumeResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ResumeResult>;
  const profile = result.profile;
  return (
    (result.mode === "claude" || result.mode === "fallback") &&
    typeof result.text === "string" && result.text.length <= MAX_TEXT_LENGTH &&
    Array.isArray(result.warnings) && result.warnings.length <= 10 &&
    result.warnings.every((warning) => typeof warning === "string" && warning.length <= 500) &&
    !!profile && typeof profile.background === "string" && profile.background.length <= 2000 &&
    typeof profile.experience === "string" && profile.experience.length <= 2000 &&
    Array.isArray(profile.skills) && profile.skills.length <= 30 &&
    profile.skills.every((skill) => typeof skill === "string" && skill.length <= 80) &&
    profile.skills.join(", ").length <= 1000
  );
}

export function ResumeUpload({ disabled, onExtracted, onBusyChange }: ResumeUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [useClaude, setUseClaude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResumeResult | null>(null);
  const active = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function extract(source: "file" | "text") {
    if (active.current || disabled) return;
    setError(null);
    if (source === "file" && (!file || !/\.(pdf|txt)$/i.test(file.name))) {
      setError("Choose a PDF or TXT resume.");
      return;
    }
    if (source === "file" && file && (file.size === 0 || file.size > MAX_FILE_BYTES)) {
      setError("Choose a nonempty resume no larger than 2 MB.");
      return;
    }
    if (source === "text" && (!text.trim() || text.length > MAX_TEXT_LENGTH)) {
      setError("Paste between 1 and 16,000 characters of resume text.");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    onBusyChange(true);
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      let body: FormData | string;
      if (source === "file") {
        const form = new FormData();
        form.set("file", file!);
        form.set("useClaude", String(useClaude));
        body = form;
      } else {
        body = JSON.stringify({ text, useClaude });
      }
      const response = await fetch("/api/resume", {
        method: "POST",
        body,
        headers: source === "text" ? { "Content-Type": "application/json" } : undefined,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (active.current !== controller) return;
      if (!response.ok) {
        const message = (payload as { error?: { message?: unknown } })?.error?.message;
        throw new Error(typeof message === "string" && message.length <= 500
          ? message : "This resume could not be read. Try TXT, paste text, or continue manually.");
      }
      if (!isResumeResult(payload)) throw new Error("The extraction response was unreadable. Please try again.");
      setResult(payload);
      onExtracted(payload);
      // Release file and pasted input references once processing finishes.
      setFile(null);
      setText("");
      if (fileInput.current) fileInput.current.value = "";
    } catch (cause) {
      if (active.current !== controller) return;
      setError(controller.signal.aborted
        ? "Resume processing timed out. Try a smaller file, paste text, or continue manually."
        : cause instanceof Error ? cause.message : "Could not read your resume. Please try again.");
    } finally {
      clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    onBusyChange(false);
    setError(null);
  }

  return (
    <section className={styles.panel} aria-labelledby="resume-heading" aria-busy={busy}>
      <h2 id="resume-heading">Start with your resume <span>(optional)</span></h2>
      <p>Upload a PDF or TXT file, up to 2 MB, to fill in your education, experience, and skills. You can edit everything below.</p>
      <p className={styles.privacy}>Files are processed in memory and never stored. Selectable text only; scanned PDFs need a TXT version or pasted text. Your reviewed profile is saved in this browser when you create a path.</p>
      <label className={styles.check}>
        <input type="checkbox" checked={useClaude} disabled={busy || disabled} onChange={(event) => setUseClaude(event.target.checked)} />
        <span>Use Claude, when available, to organize my resume</span>
      </label>
      <p className={styles.privacy}>If selected and configured, extracted resume text is sent to Anthropic’s Claude. Leave unchecked to use local rules on this server. If Claude is unavailable, local extraction still works. Creating a learning path also sends the profile fields below to Claude when configured.</p>
      <label className="field-label" htmlFor="resume-file">Resume file</label>
      <input ref={fileInput} id="resume-file" type="file" accept=".pdf,.txt,application/pdf,text/plain" disabled={busy || disabled} onChange={(event) => { setFile(event.target.files?.[0] || null); setError(null); }} />
      <div className={styles.actions}>
        <button type="button" className="button button-secondary" disabled={busy || disabled || !file} onClick={() => void extract("file")}>Read resume</button>
        {busy && <button type="button" className="button button-secondary" onClick={cancel}>Cancel extraction</button>}
      </div>
      <details className={styles.paste}>
        <summary>Or paste resume text</summary>
        <label className="field-label" htmlFor="resume-text">Resume text (up to 16,000 characters)</label>
        <textarea id="resume-text" rows={5} maxLength={MAX_TEXT_LENGTH} value={text} disabled={busy || disabled} onChange={(event) => setText(event.target.value)} placeholder="Paste education, work or project experience, and skills." />
        <div className={styles.actions}>
          <button type="button" className="button button-secondary" disabled={busy || disabled || !text.trim()} onClick={() => void extract("text")}>Read pasted text</button>
        </div>
      </details>
      {busy && <p role="status">Reading your resume… You can keep editing your profile.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && (
        <div aria-live="polite">
          <p><strong>{result.mode === "claude" ? "Organized with Claude." : "Extracted with local rules."}</strong> Empty profile fields have been filled. Existing values are kept; replacement options appear below. Review all fields before continuing.</p>
          {result.warnings.length > 0 && <ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          <details className={styles.source}>
            <summary>Inspect extracted source text</summary>
            <pre>{result.text}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

export function ResumeSuggestion({ label, value, onReplace, disabled }: {
  label: string; value: string; onReplace: () => void; disabled: boolean;
}) {
  return (
    <details className={styles.suggestion}>
      <summary>Resume suggestion for {label}</summary>
      <p>{value || "No supported information found. Keep or enter your own value."}</p>
      {value && <button type="button" className="button button-secondary" disabled={disabled} onClick={onReplace}>Replace {label} with resume value</button>}
    </details>
  );
}

export function ResumeReview({ reviewed, onChange, disabled }: {
  reviewed: boolean; onChange: (value: boolean) => void; disabled: boolean;
}) {
  return (
    <div className={styles.review}>
      <label className={styles.check}>
        <input id="resume-reviewed" type="checkbox" checked={reviewed} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span>I reviewed and corrected the resume information in my profile.</span>
      </label>
      <p>Check education, experience, and skills above, then confirm to create your path. Your goal, track, and weekly study time remain your choices.</p>
    </div>
  );
}
