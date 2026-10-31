"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LearningProvider, type LearningWorkspaceControls } from "@/lib/learning-context";
import { EMPTY_STATE, parseLearningState } from "@/lib/learning-state";
import { loadGuestLibrary, summaryForPath, writeGuestLibrary, type GuestLearningPath, type LearningPathSummary } from "@/lib/learning-library";
import { useOptionalAccount } from "@/lib/account-context";
import { AccountApiError, createAccountTrack, deleteAccountTrack, getAccountTrack, listAccountTracks } from "@/lib/account-client";
import { createTrackSync } from "@/lib/account-sync";
import type { AccountTrack } from "@/lib/account-types";
import type { LearningState } from "@/lib/types";

type CachedPath = GuestLearningPath & { revision?: number };
const message = (error: unknown) => error instanceof Error ? error.message : "Your learning could not be saved. Please try again.";
const saveMessage = (error: unknown) => error instanceof AccountApiError && error.code === "REVISION_CONFLICT"
  ? "This path changed in another tab. Retrying saves this tab’s unsynced progress as a separate recovered path, keeping both versions."
  : message(error);
const activeKey = (userId: string) => `ownpath:account:${userId}:active`;

/** Owns path selection and persistence; the teaching provider stays path-local. */
export function LearningWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const account = useOptionalAccount();
  const [paths, setPaths] = useState<LearningPathSummary[]>([]);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LearningState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [hydratedIdentity, setHydratedIdentity] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [guestTrackCount, setGuestTrackCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<LearningWorkspaceControls["syncStatus"]>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const cache = useRef(new Map<string, CachedPath>());
  const summaries = useRef<LearningPathSummary[]>([]);
  const selected = useRef<string | null>(null);
  const owner = useRef<string | null>(null);
  const epoch = useRef(0);
  const actionBusy = useRef<number | null>(null);
  const baseline = useRef("");
  const initialized = useRef(false);
  const conflict = useRef(false);
  const identity = account.status === "authenticated" && account.user ? account.user.id : account.status;

  const publish = useCallback((items: LearningPathSummary[]) => {
    summaries.current = items;
    setPaths(items);
  }, []);
  const remember = useCallback((path: CachedPath) => {
    cache.current.set(path.id, path);
    const summary = summaryForPath(path);
    const existing = summaries.current.findIndex((item) => item.id === path.id);
    publish(existing < 0 ? [summary, ...summaries.current]
      : summaries.current.map((item) => item.id === path.id ? summary : item));
  }, [publish]);
  // Construction stores callbacks; refs are read only when later saves run.
  // eslint-disable-next-line react-hooks/refs
  const [sync] = useState(() => createTrackSync({
    onStatus: (status) => {
      conflict.current = status === "conflict";
      setSyncStatus(status === "pending" || status === "saving" ? "syncing"
        : status === "error" || status === "conflict" ? "error" : status);
    },
    onSaved: (record: AccountTrack) => {
      const current = cache.current.get(record.id);
      // A response can acknowledge an older queued snapshot; never roll back
      // local teaching, answers, or attempts that are waiting for the next save.
      remember({ ...record, state: current?.state ?? record.state });
      setSyncError(null);
    },
    onError: (error: unknown) => {
      conflict.current = error instanceof AccountApiError && error.code === "REVISION_CONFLICT";
      setSyncError(saveMessage(error));
    },
  }));

  const persistGuest = useCallback(() => {
    writeGuestLibrary(window.localStorage, {
      version: 2, activePathId: selected.current,
      paths: [...cache.current.values()].map(({ id, state, updatedAt }) => ({ id, state, updatedAt })),
    });
    setGuestTrackCount(cache.current.size);
  }, []);
  const activate = useCallback((path: CachedPath | null, draft = EMPTY_STATE, rememberSelection = true) => {
    selected.current = path?.id ?? null;
    setActivePathId(path?.id ?? null);
    const state = path?.state ?? draft;
    baseline.current = JSON.stringify(state);
    setSnapshot(state);
    setGeneration((value) => value + 1);
    sync.bind(owner.current && path?.revision !== undefined
      ? { userId: owner.current, trackId: path.id, revision: path.revision } : null);
    if (owner.current && rememberSelection) {
      try {
        if (path) window.localStorage.setItem(activeKey(owner.current), path.id);
        else window.localStorage.removeItem(activeKey(owner.current));
      } catch { /* Selection memory is optional; progress lives on the server. */ }
    }
  }, [sync]);

  useEffect(() => {
    if (account.status === "loading") return;
    const currentEpoch = ++epoch.current;
    const controller = new AbortController();
    initialized.current = false;
    sync.cancel();
    owner.current = account.user?.id ?? null;
    const userId = owner.current;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true); setSyncError(null); setSyncStatus("idle");
      cache.current.clear(); publish([]); activate(null, EMPTY_STATE, false);
      void (async () => {
        try {
          let guests;
          try { guests = loadGuestLibrary(window.localStorage); }
          catch (error) {
            if (!userId) throw error;
            guests = { version: 2 as const, activePathId: null, paths: [] };
          }
          setGuestTrackCount(guests.paths.length);
          if (!userId) {
            guests.paths.forEach((path) => cache.current.set(path.id, path));
            publish(guests.paths.map(summaryForPath));
            activate(guests.paths.find((path) => path.id === guests.activePathId) ?? null);
          } else {
            const listed = await listAccountTracks(userId, controller.signal);
            if (controller.signal.aborted || currentEpoch !== epoch.current) return;
            publish(listed);
            let preferred: string | null = null;
            try { preferred = window.localStorage.getItem(activeKey(userId)); } catch { /* Optional. */ }
            const target = listed.find((path) => path.id === preferred) ?? listed[0];
            if (target) {
              const record = await getAccountTrack(userId, target.id, controller.signal);
              if (controller.signal.aborted || currentEpoch !== epoch.current) return;
              remember(record); activate(record);
            }
          }
        } catch (error) {
          if (!controller.signal.aborted && currentEpoch === epoch.current) {
            setSyncError(message(error)); setSyncStatus("error");
          }
        } finally {
          if (!controller.signal.aborted && currentEpoch === epoch.current) {
            initialized.current = true; setLoading(false);
            setHydratedIdentity(userId ?? "guest");
          }
        }
      })();
    });
    return () => { controller.abort(); initialized.current = false; sync.cancel(); };
  }, [account.status, account.user?.id, sync, activate, publish, remember]);

  const registerBeforeLogout = account.registerBeforeLogout;
  useEffect(() => registerBeforeLogout(() => sync.flush()), [registerBeforeLogout, sync]);

  const onStateChange = useCallback((state: LearningState, expectedOwner: string | null, expectedPath: string | null) => {
    const id = selected.current;
    if (owner.current !== expectedOwner || id !== expectedPath) return;
    if (!initialized.current || !id || !state.plan || baseline.current === JSON.stringify(state)) return;
    const existing = cache.current.get(id);
    if (!existing || existing.state.planGeneration !== state.planGeneration) return;
    baseline.current = JSON.stringify(state);
    remember({ ...existing, state, updatedAt: new Date().toISOString() });
    if (owner.current) sync.schedule(state);
    else {
      try { persistGuest(); setSyncStatus("saved"); setSyncError(null); }
      catch (error) { setSyncError(message(error)); setSyncStatus("error"); }
    }
  }, [persistGuest, remember, sync]);

  const action = useCallback(async (run: () => Promise<void>) => {
    if (owner.current !== (account.user?.id ?? null) || hydratedIdentity !== identity)
      throw new Error("Your account changed. Please use the current learning space.");
    if (actionBusy.current === epoch.current || !initialized.current) throw new Error("Your learning space is still loading. Please try again in a moment.");
    const currentEpoch = epoch.current;
    actionBusy.current = currentEpoch;
    try { await run(); }
    catch (error) { if (currentEpoch === epoch.current) { setSyncError(saveMessage(error)); setSyncStatus("error"); } throw error; }
    finally { if (actionBusy.current === currentEpoch) actionBusy.current = null; }
  }, [account.user?.id, hydratedIdentity, identity]);
  const assertSession = useCallback((expected: number) => {
    if (expected !== epoch.current) throw new Error("Your account changed. Please try again in the current account.");
  }, []);
  const onPlanCreated = useCallback((input: LearningState) => action(async () => {
    const state = parseLearningState(input), currentEpoch = epoch.current;
    await sync.flush(); assertSession(currentEpoch);
    const path: CachedPath = owner.current
      ? await createAccountTrack(owner.current, state)
      : { id: crypto.randomUUID(), state, updatedAt: new Date().toISOString() };
    assertSession(currentEpoch);
    remember(path); activate(path);
    if (!owner.current) persistGuest();
    setSyncError(null); setSyncStatus("saved");
  }), [action, activate, assertSession, persistGuest, remember, sync]);

  const switchPath = useCallback((id: string) => action(async () => {
    const currentEpoch = epoch.current;
    await sync.flush(); assertSession(currentEpoch);
    const path = owner.current ? await getAccountTrack(owner.current, id) : cache.current.get(id);
    assertSession(currentEpoch);
    if (!path) throw new Error("This saved path is no longer available.");
    remember(path); activate(path);
    if (!owner.current) persistGuest();
    setSyncError(null);
  }), [action, activate, assertSession, persistGuest, remember, sync]);

  const newPath = useCallback(() => action(async () => {
    const currentEpoch = epoch.current;
    await sync.flush(); assertSession(currentEpoch);
    const profile = selected.current ? cache.current.get(selected.current)?.state.profile : null;
    activate(null, profile ? { ...EMPTY_STATE, profile: { ...profile, goals: "" } } : EMPTY_STATE);
    if (!owner.current) persistGuest();
    setSyncError(null);
  }), [action, activate, assertSession, persistGuest, sync]);

  const deletePath = useCallback((id: string) => action(async () => {
    const currentEpoch = epoch.current;
    await sync.flush(); assertSession(currentEpoch);
    const userId = owner.current;
    if (userId) {
      const path = cache.current.get(id) ?? await getAccountTrack(userId, id);
      assertSession(currentEpoch);
      await deleteAccountTrack(userId, id, path.revision!);
      assertSession(currentEpoch);
    }
    cache.current.delete(id);
    const remaining = summaries.current.filter((path) => path.id !== id);
    publish(remaining);
    if (selected.current === id) {
      activate(null);
      if (remaining[0]) {
        const next = owner.current ? await getAccountTrack(owner.current, remaining[0].id) : cache.current.get(remaining[0].id);
        assertSession(currentEpoch);
        if (next) { remember(next); activate(next); }
      }
    }
    if (!owner.current) persistGuest();
    setSyncError(null);
  }), [action, activate, assertSession, persistGuest, publish, remember, sync]);

  const importGuestTracks = useCallback(() => action(async () => {
    const userId = owner.current, currentEpoch = epoch.current;
    if (!userId) throw new Error("Sign in before importing browser tracks.");
    await sync.flush(); assertSession(currentEpoch);
    let guests = loadGuestLibrary(window.localStorage);
    let first: AccountTrack | null = null;
    for (const guest of [...guests.paths]) {
      const saved = await createAccountTrack(userId, guest.state, undefined, guest.id);
      assertSession(currentEpoch);
      remember(saved); first ??= saved;
      guests = { ...guests, paths: guests.paths.filter((path) => path.id !== guest.id) };
      if (guests.activePathId === guest.id) guests.activePathId = guests.paths[0]?.id ?? null;
      writeGuestLibrary(window.localStorage, guests);
      setGuestTrackCount(guests.paths.length);
    }
    if (!selected.current && first) activate(first);
    setSyncError(null); setSyncStatus("saved");
  }), [action, activate, assertSession, remember, sync]);

  const retrySync = useCallback(() => action(async () => {
    const currentEpoch = epoch.current;
    if (!owner.current) { persistGuest(); setSyncError(null); setSyncStatus("saved"); return; }
    if (conflict.current && selected.current) {
      const current = cache.current.get(selected.current);
      if (!current?.state.plan) throw new Error("Open your path before retrying.");
      const state = { ...current.state, plan: { ...current.state.plan, title: `${current.state.plan.title.slice(0, 180)} (recovered copy)` } };
      const saved = await createAccountTrack(owner.current, state);
      assertSession(currentEpoch);
      remember(saved); activate(saved);
    } else await sync.flush();
    assertSession(currentEpoch);
    setSyncError(null); setSyncStatus("saved");
  }), [action, activate, assertSession, persistGuest, remember, sync]);

  const identityReady = hydratedIdentity === identity && account.status !== "loading";
  const expectedOwner = account.user?.id ?? null;
  const persistActiveState = useCallback((state: LearningState) => {
    onStateChange(state, expectedOwner, activePathId);
  }, [onStateChange, expectedOwner, activePathId]);
  const workspace: LearningWorkspaceControls = {
    accountUser: identityReady ? account.user : null,
    paths: identityReady ? paths : [], activePathId: identityReady ? activePathId : null,
    switchPath, newPath, deletePath, guestTrackCount: identityReady ? guestTrackCount : 0, importGuestTracks,
    syncStatus: identityReady ? syncStatus : "idle", syncError: identityReady ? syncError : null,
    retrySync, logoutAccount: account.logout,
  };
  return <LearningProvider key={`${identity}:${identityReady ? activePathId ?? "draft" : "loading"}:${generation}`}
    initialState={identityReady ? snapshot : EMPTY_STATE} onStateChange={persistActiveState} onPlanCreated={onPlanCreated}
    workspace={workspace} isReady={identityReady && !loading}>
    {children}
  </LearningProvider>;
}
