import type { AccountTrack } from "@/lib/account-types";
import { AccountApiError, saveAccountTrack } from "@/lib/account-client";
import type { LearningState } from "@/lib/types";

export type TrackSyncStatus = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";
export interface TrackSyncBinding { userId: string; trackId: string; revision: number }
interface TrackSyncOptions {
  save?: typeof saveAccountTrack;
  delayMs?: number;
  onStatus?: (status: TrackSyncStatus) => void;
  onSaved?: (track: AccountTrack, binding: TrackSyncBinding) => void;
  onError?: (error: Error, binding: TrackSyncBinding) => void;
}

/** One active path, one write at a time, with no automatic conflict overwrite. */
export function createTrackSync(options: TrackSyncOptions = {}) {
  const save = options.save ?? saveAccountTrack;
  let binding: TrackSyncBinding | null = null;
  let pending: LearningState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let epoch = 0, disposed = false, blocked = false;
  let status: TrackSyncStatus = "idle";
  let active: { epoch: number; controller: AbortController; promise: Promise<void> } | null = null;

  function setStatus(next: TrackSyncStatus) {
    status = next;
    if (!disposed) options.onStatus?.(next);
  }
  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function current(ticket: NonNullable<typeof active>) {
    return !disposed && ticket.epoch === epoch && active === ticket && !ticket.controller.signal.aborted;
  }
  function drain(): Promise<void> {
    if (active) return active.promise;
    if (disposed || !binding || !pending) return Promise.resolve();
    const ticket = { epoch, controller: new AbortController(), promise: Promise.resolve() };
    active = ticket;
    ticket.promise = Promise.resolve().then(async () => {
      while (current(ticket) && binding && pending) {
        const state = pending, target = { ...binding };
        pending = null;
        setStatus("saving");
        try {
          const saved = await save(target.userId, target.trackId, state, target.revision, ticket.controller.signal);
          if (!current(ticket) || !binding) return;
          if (saved.id !== target.trackId || saved.revision <= target.revision)
            throw new AccountApiError(502, "The saved path revision was unreadable. Please try again.");
          binding = { ...target, revision: saved.revision };
          options.onSaved?.(saved, { ...binding });
        } catch (cause) {
          if (!current(ticket)) return;
          // Keep the newest local edit when an earlier write fails.
          pending ??= state;
          blocked = true;
          clearTimer();
          const error = cause instanceof Error ? cause : new Error("Your learning path could not be saved. Please try again.");
          setStatus(error instanceof AccountApiError && error.status === 409 ? "conflict" : "error");
          options.onError?.(error, target);
          throw error;
        }
      }
      if (current(ticket)) setStatus("saved");
    }).finally(() => { if (active === ticket) active = null; });
    return ticket.promise;
  }
  function cancel() {
    epoch++;
    clearTimer();
    active?.controller.abort();
    active = null;
    pending = null;
    binding = null;
    blocked = false;
    setStatus("idle");
  }
  function bind(next: TrackSyncBinding | null) {
    if (disposed) return;
    if (binding && next && binding.userId === next.userId && binding.trackId === next.trackId && binding.revision === next.revision) return;
    cancel();
    binding = next ? { ...next } : null;
  }
  function schedule(state: LearningState) {
    if (disposed || !binding) return;
    pending = state;
    clearTimer();
    if (blocked) return;
    if (!active) setStatus("pending");
    timer = setTimeout(() => {
      timer = null;
      // Scheduled saves report through callbacks; explicit flush still rejects.
      void drain().catch(() => {});
    }, options.delayMs ?? 600);
  }
  function flush(): Promise<void> {
    clearTimer();
    blocked = false;
    return drain();
  }
  function dispose() { disposed = true; cancel(); }

  return { bind, schedule, flush, cancel, dispose,
    get status() { return status; },
    get binding() { return binding ? { ...binding } : null; },
  };
}
export type TrackSyncController = ReturnType<typeof createTrackSync>;
