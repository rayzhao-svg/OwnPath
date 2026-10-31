import { parseLearningState } from "@/lib/learning-state";
import type { LearningState, LearningTrack } from "@/lib/types";

export const GUEST_LIBRARY_KEY = "ownpath:library:v2";
export const MAX_GUEST_PATHS = 100;
const LEGACY_KEY = "ownpath:learning:v1";

export interface GuestLearningPath {
  id: string;
  state: LearningState;
  updatedAt: string;
}

export interface GuestLearningLibrary {
  version: 2;
  activePathId: string | null;
  paths: GuestLearningPath[];
}

export interface LearningPathSummary {
  id: string;
  title: string;
  track: LearningTrack;
  profileName: string;
  moduleCount: number;
  completedModuleCount: number;
  updatedAt: string;
}

type LibraryStorage = Pick<Storage, "getItem" | "setItem">;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function envelope(value: unknown): asserts value is { version: 2; activePathId: string | null; paths: unknown[] } {
  if (!record(value) || value.version !== 2 || !Array.isArray(value.paths) || value.paths.length > MAX_GUEST_PATHS ||
      (value.activePathId !== null && !validId(value.activePathId)))
    throw new Error("Your saved guest learning library could not be read. Its original browser data is unchanged.");
}

function parsePath(value: unknown): GuestLearningPath {
  if (!record(value) || !validId(value.id) || typeof value.updatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.updatedAt) ||
      !Number.isFinite(Date.parse(value.updatedAt)))
    throw new Error("Invalid saved learning track.");
  const state = parseLearningState(value.state);
  if (!state.profile || !state.plan) throw new Error("A saved learning track needs its learner profile and curriculum.");
  return { id: value.id, state, updatedAt: value.updatedAt };
}

export function summaryForPath(path: GuestLearningPath): LearningPathSummary {
  const { profile, plan } = path.state;
  if (!profile || !plan) throw new Error("A saved learning track needs its learner profile and curriculum.");
  return {
    id: path.id, title: plan.title, track: plan.track, profileName: profile.name,
    moduleCount: plan.modules.length,
    completedModuleCount: plan.modules.filter((module) => module.status === "completed").length,
    updatedAt: path.updatedAt,
  };
}

/** Read each track independently so one damaged entry cannot hide valid progress. */
export function loadGuestLibrary(storage: LibraryStorage, onWarning?: (message: string) => void): GuestLearningLibrary {
  const raw = storage.getItem(GUEST_LIBRARY_KEY);
  if (raw !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("Your saved guest learning library is unreadable. Its original browser data is unchanged."); }
    envelope(parsed);
    const paths: GuestLearningPath[] = [];
    const ids = new Set<string>();
    for (const entry of parsed.paths) {
      try {
        const path = parsePath(entry);
        if (ids.has(path.id)) throw new Error("Duplicate learning track.");
        ids.add(path.id);
        paths.push(path);
      } catch {
        onWarning?.("Some saved guest tracks could not be loaded. Your other tracks are still available.");
      }
    }
    const activePathId = parsed.activePathId === null ? null
      : ids.has(parsed.activePathId) ? parsed.activePathId : paths[0]?.id ?? null;
    if (activePathId !== parsed.activePathId)
      onWarning?.("The last selected guest track could not be loaded. Another saved track is available.");
    return { version: 2, activePathId, paths };
  }

  const legacy = storage.getItem(LEGACY_KEY);
  if (legacy === null) return { version: 2, activePathId: null, paths: [] };
  let state: LearningState;
  try { state = parseLearningState(JSON.parse(legacy)); }
  catch { throw new Error("Your previous guest learning could not be loaded. Its original browser data is unchanged."); }
  const path = state.profile && state.plan ? { id: crypto.randomUUID(), state, updatedAt: new Date().toISOString() } : null;
  const library: GuestLearningLibrary = { version: 2, activePathId: path?.id ?? null, paths: path ? [path] : [] };
  try { writeGuestLibrary(storage, library); }
  catch { onWarning?.("Your previous guest learning is available, but this browser could not save the updated library. Keep this tab open to continue."); }
  return library;
}

/** Explicit saves reject malformed state instead of silently discarding a track. */
export function writeGuestLibrary(storage: LibraryStorage, library: GuestLearningLibrary): void {
  envelope(library);
  const paths = library.paths.map(parsePath);
  const ids = new Set(paths.map((path) => path.id));
  if (ids.size !== paths.length || (library.activePathId !== null && !ids.has(library.activePathId)))
    throw new Error("The guest learning library could not be saved because its selected track is invalid.");
  storage.setItem(GUEST_LIBRARY_KEY, JSON.stringify({ version: 2, activePathId: library.activePathId, paths }));
}
