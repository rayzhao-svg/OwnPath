import type { AccountTrack, AccountTrackSummary, AccountUser } from "@/lib/account-types";
import { MAX_ACCOUNT_STATE_BYTES } from "@/lib/account-types";
import { parseLearningState } from "@/lib/learning-state";
import type { LearningState } from "@/lib/types";

export class AccountApiError extends Error {
  constructor(public status: number, message: string, public code = "ACCOUNT_ERROR") {
    super(message);
    this.name = "AccountApiError";
  }
}
export { AccountApiError as AccountClientError };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function invalid(): never { throw new AccountApiError(502, "OwnPath returned unreadable account data. Please try again."); }
function user(value: unknown): AccountUser {
  if (!record(value) || !boundedText(value.id, 100) || !boundedText(value.name, 100) || !boundedText(value.email, 254)) invalid();
  return { id: value.id, name: value.name, email: value.email };
}
function summary(value: unknown): AccountTrackSummary {
  if (!record(value) || !boundedText(value.id, 100) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
      !boundedText(value.updatedAt, 100) || !Number.isFinite(Date.parse(value.updatedAt)) ||
      !boundedText(value.title, 200) || !boundedText(value.profileName, 100) ||
      !["data-science", "web-development", "product-design"].includes(String(value.track)) ||
      !Number.isSafeInteger(value.moduleCount) || Number(value.moduleCount) < 1 || Number(value.moduleCount) > 100 ||
      !Number.isSafeInteger(value.completedModuleCount) || Number(value.completedModuleCount) < 0 || Number(value.completedModuleCount) > Number(value.moduleCount)) invalid();
  return value as unknown as AccountTrackSummary;
}
function track(value: unknown): AccountTrack {
  if (!record(value) || !boundedText(value.id, 100) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
      !boundedText(value.updatedAt, 100) || !Number.isFinite(Date.parse(value.updatedAt))) invalid();
  let state: LearningState;
  try { state = parseLearningState(value.state); } catch { invalid(); }
  return { id: value.id, revision: Number(value.revision), updatedAt: value.updatedAt, state };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_ACCOUNT_STATE_BYTES + 64 * 1024) invalid();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ACCOUNT_STATE_BYTES + 64 * 1024) invalid();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function request(path: string, options: { method?: string; body?: unknown; userId?: string; signal?: AbortSignal; importKey?: string } = {}): Promise<unknown> {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body && new TextEncoder().encode(body).byteLength > MAX_ACCOUNT_STATE_BYTES)
    throw new AccountApiError(413, "This learning path is too large to save. Your current progress is unchanged.");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 20_000);
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  try {
    const response = await fetch(path, {
      method: options.method ?? "GET", body, signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: {
        Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}),
        ...(options.userId ? { "X-OwnPath-Account": options.userId } : {}),
        ...(options.importKey ? { "Idempotency-Key": options.importKey } : {}),
      },
    });
    let data: unknown;
    try { data = await readJson(response); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new AccountApiError(response.status || 502, "OwnPath returned an unreadable account response. Please try again.");
    }
    if (!response.ok) {
      const error = record(data) && record(data.error) ? data.error : null;
      throw new AccountApiError(response.status, error && boundedText(error.message, 500)
        ? error.message : "Your account request could not be completed. Please try again.",
      error && boundedText(error.code, 100) ? error.code : "ACCOUNT_ERROR");
    }
    return data;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Request canceled", "AbortError");
    if (deadline.signal.aborted) throw new AccountApiError(408, "Your account request took too long. Please try again.");
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError(0, "Could not reach OwnPath. Check your connection and try again.");
  } finally { clearTimeout(timer); }
}

export async function getSession(signal?: AbortSignal): Promise<AccountUser | null> {
  const data = await request("/api/auth/session", { signal });
  if (!record(data)) invalid();
  return data.user === null ? null : user(data.user);
}
export async function registerAccount(input: { name: string; email: string; password: string }, signal?: AbortSignal): Promise<AccountUser> {
  const data = await request("/api/auth/register", { method: "POST", body: input, signal });
  return record(data) ? user(data.user) : invalid();
}
export async function loginAccount(input: { email: string; password: string }, signal?: AbortSignal): Promise<AccountUser> {
  const data = await request("/api/auth/login", { method: "POST", body: input, signal });
  return record(data) ? user(data.user) : invalid();
}
export async function logoutAccount(signal?: AbortSignal, userId?: string): Promise<void> {
  const data = await request("/api/auth/logout", { method: "POST", body: {}, signal, userId });
  if (!record(data) || data.user !== null) invalid();
}
export async function listAccountTracks(userId: string, signal?: AbortSignal): Promise<AccountTrackSummary[]> {
  const data = await request("/api/account/tracks", { userId, signal });
  if (!record(data) || !Array.isArray(data.tracks) || data.tracks.length > 1000) invalid();
  return data.tracks.map(summary);
}
export async function createAccountTrack(userId: string, state: LearningState, signal?: AbortSignal, importKey = crypto.randomUUID()): Promise<AccountTrack> {
  const data = await request("/api/account/tracks", { method: "POST", body: { state }, userId, signal, importKey });
  return record(data) ? track(data.track) : invalid();
}
export async function getAccountTrack(userId: string, id: string, signal?: AbortSignal): Promise<AccountTrack> {
  const data = await request(`/api/account/tracks/${encodeURIComponent(id)}`, { userId, signal });
  const saved = record(data) ? track(data.track) : invalid();
  if (saved.id !== id) invalid();
  return saved;
}
export async function saveAccountTrack(userId: string, id: string, state: LearningState, revision: number, signal?: AbortSignal): Promise<AccountTrack> {
  const data = await request(`/api/account/tracks/${encodeURIComponent(id)}`, { method: "PUT", body: { state, revision }, userId, signal });
  const saved = record(data) ? track(data.track) : invalid();
  if (saved.id !== id || saved.revision <= revision) invalid();
  return saved;
}
export async function deleteAccountTrack(userId: string, id: string, revision: number, signal?: AbortSignal): Promise<void> {
  const data = await request(`/api/account/tracks/${encodeURIComponent(id)}`, { method: "DELETE", body: { revision }, userId, signal });
  if (!record(data) || data.deleted !== true) invalid();
}
