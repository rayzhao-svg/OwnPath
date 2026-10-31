import "server-only";

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MAX_ACCOUNT_STATE_BYTES, MAX_ACCOUNT_TRACKS } from "@/lib/account-types";
import type { AccountTrack, AccountTrackSummary, AccountUser } from "@/lib/account-types";
import { parseLearningState } from "@/lib/learning-state";
import { MAX_STORED_LESSON_BYTES } from "@/lib/lesson-budget";
import type { LearningState } from "@/lib/types";

export class AccountFailure extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const PASSWORD_PREFIX = "scrypt$32768$8$3$";
type UserRow = AccountUser & { password_hash: string; password_salt: string };
type TrackRow = { id: string; revision: number; updated_at: string; state_json: string; plan_id: string };
const storage = globalThis as typeof globalThis & {
  __ownpathAccountDatabases?: Map<string, DatabaseSync>;
  __ownpathAccountKdf?: { active: number; queue: (() => void)[] };
};

function database(): DatabaseSync {
  const filename = process.env.OWNPATH_DATABASE_PATH === ":memory:"
    ? ":memory:" : resolve(process.env.OWNPATH_DATABASE_PATH || ".data/ownpath.sqlite");
  const connections = storage.__ownpathAccountDatabases ??= new Map();
  const existing = connections.get(filename);
  if (existing) return existing;
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS account_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS account_session_expiry ON account_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS account_tracks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision >= 1),
      state_json TEXT NOT NULL CHECK(json_valid(state_json)),
      title TEXT NOT NULL,
      learning_track TEXT NOT NULL,
      profile_name TEXT NOT NULL,
      module_count INTEGER NOT NULL,
      completed_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS account_track_owner ON account_tracks(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS account_track_imports (
      user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
      import_key TEXT NOT NULL,
      track_id TEXT NOT NULL REFERENCES account_tracks(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, import_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_auth_limits (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
  `);
  connections.set(filename, db);
  return db;
}

/** Also lets a host shut down cleanly; reopening preserves the file-backed data. */
export function closeAccountStore(): void {
  for (const db of storage.__ownpathAccountDatabases?.values() ?? []) db.close();
  storage.__ownpathAccountDatabases?.clear();
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function publicUser(row: AccountUser): AccountUser { return { id: row.id, name: row.name, email: row.email }; }

export function normalizeAccountEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim()))
    throw new AccountFailure(400, "INVALID_INPUT", "Enter a valid email address.");
  return value.trim().toLowerCase();
}

export function validateAccountPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new AccountFailure(400, "INVALID_INPUT", "Use a password between 12 and 128 characters.");
  return value;
}

export function validateAccountName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/u.test(value))
    throw new AccountFailure(400, "INVALID_INPUT", "Enter a name between 1 and 100 characters.");
  return value.trim();
}

async function passwordKey(password: string, salt: string, legacy = false): Promise<Buffer> {
  const capacity = storage.__ownpathAccountKdf ??= { active: 0, queue: [] };
  await new Promise<void>((accept, reject) => {
    if (capacity.active < 2) { capacity.active++; accept(); }
    else if (capacity.queue.length < 8) capacity.queue.push(accept);
    else reject(new AccountFailure(429, "RATE_LIMITED", "Sign-in is busy. Wait a moment and try again.", 1));
  });
  try {
    return await new Promise<Buffer>((resolveKey, reject) => {
      scrypt(password, salt, 64, legacy ? { ...SCRYPT_OPTIONS, p: 1 } : SCRYPT_OPTIONS,
        (error, key) => error ? reject(error) : resolveKey(key));
    });
  } finally {
    const next = capacity.queue.shift();
    if (next) next();
    else capacity.active--;
  }
}

/** A database-backed window survives process restarts and development reloads. */
export function limitAccountAttempts(bucket: string, limit: number, windowMs = 15 * 60 * 1000): void {
  const db = database(), now = Date.now();
  db.prepare("DELETE FROM account_auth_limits WHERE expires_at <= ?").run(now);
  const row = db.prepare(`
    INSERT INTO account_auth_limits(bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1
    RETURNING attempts, expires_at
  `).get(hash(bucket), now + windowMs) as { attempts: number; expires_at: number };
  if (row.attempts > limit)
    throw new AccountFailure(429, "RATE_LIMITED", "Too many sign-in attempts. Wait a few minutes and try again.", Math.max(1, Math.ceil((row.expires_at - now) / 1000)));
}

export async function registerAccount(input: { name: unknown; email: unknown; password: unknown }): Promise<AccountUser> {
  const name = validateAccountName(input.name), email = normalizeAccountEmail(input.email), password = validateAccountPassword(input.password);
  const salt = randomBytes(16).toString("hex"), key = await passwordKey(password, salt);
  const user = { id: randomUUID(), name, email };
  try {
    database().prepare("INSERT INTO account_users(id, email, name, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(user.id, email, name, salt, PASSWORD_PREFIX + key.toString("hex"), Date.now());
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: account_users.email/.test(error.message))
      throw new AccountFailure(409, "EMAIL_IN_USE", "An account already uses that email. Sign in instead.");
    throw error;
  } finally { key.fill(0); }
  return user;
}

export async function authenticateAccount(input: { email: unknown; password: unknown }): Promise<AccountUser> {
  const email = normalizeAccountEmail(input.email), password = validateAccountPassword(input.password);
  limitAccountAttempts(`email:${email}`, 8);
  const row = database().prepare("SELECT id, name, email, password_hash, password_salt FROM account_users WHERE email = ?").get(email) as UserRow | undefined;
  const legacy = !!row && /^[0-9a-f]{128}$/.test(row.password_hash);
  const encodedHash = row?.password_hash.startsWith(PASSWORD_PREFIX) ? row.password_hash.slice(PASSWORD_PREFIX.length)
    : legacy ? row!.password_hash : "0".repeat(128);
  // Unknown users still do the same expensive derivation and fixed-length compare.
  const key = await passwordKey(password, row?.password_salt ?? "0".repeat(32), legacy);
  const expected = Buffer.from(encodedHash, "hex");
  const matches = expected.length === key.length && timingSafeEqual(key, expected);
  key.fill(0);
  if (!row || !matches) throw new AccountFailure(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
  if (legacy) {
    const salt = randomBytes(16).toString("hex"), upgraded = await passwordKey(password, salt);
    try {
      database().prepare("UPDATE account_users SET password_salt=?,password_hash=? WHERE id=? AND password_salt=? AND password_hash=?")
        .run(salt, PASSWORD_PREFIX + upgraded.toString("hex"), row.id, row.password_salt, row.password_hash);
    } finally { upgraded.fill(0); }
  }
  database().prepare("DELETE FROM account_auth_limits WHERE bucket = ?").run(hash(`email:${email}`));
  return publicUser(row);
}

export function createAccountSession(userId: string): string {
  const token = randomBytes(32).toString("base64url"), now = Date.now();
  const db = database();
  db.prepare("DELETE FROM account_sessions WHERE expires_at <= ?").run(now);
  db.prepare("INSERT INTO account_sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hash(token), userId, now + SESSION_LIFETIME_MS);
  return token;
}

export function findAccountSession(token: string | null): AccountUser | null {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = database().prepare(`
    SELECT u.id, u.name, u.email FROM account_sessions s
    JOIN account_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(hash(token), Date.now()) as AccountUser | undefined;
  return row ? publicUser(row) : null;
}

export function deleteAccountSession(token: string | null): void {
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) database().prepare("DELETE FROM account_sessions WHERE token_hash = ?").run(hash(token));
}

export function validateAccountState(value: unknown): LearningState {
  let state: LearningState;
  try { state = parseLearningState(value); }
  catch { throw new AccountFailure(400, "INVALID_PROGRESS", "This learning path could not be validated. Your saved progress is unchanged."); }
  if (!state.profile || !state.plan)
    throw new AccountFailure(400, "INVALID_PROGRESS", "Save a learning path with a profile and curriculum.");
  if (Object.values(state.lessons).some((lesson) => Buffer.byteLength(JSON.stringify(lesson), "utf8") > MAX_STORED_LESSON_BYTES))
    throw new AccountFailure(413, "PAYLOAD_TOO_LARGE", "A saved course exceeds the 512 KiB storage limit. Your current progress is unchanged.");
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_ACCOUNT_STATE_BYTES)
    throw new AccountFailure(413, "PAYLOAD_TOO_LARGE", "This learning path exceeds the 8 MiB storage limit.");
  return state;
}

function trackState(row: TrackRow): AccountTrack {
  return { id: row.id, revision: row.revision, updatedAt: row.updated_at, state: validateAccountState(JSON.parse(row.state_json)) };
}

function trackMetadata(state: LearningState) {
  return {
    title: state.plan!.title, track: state.plan!.track, profileName: state.profile!.name,
    moduleCount: state.plan!.modules.length,
    completed: state.plan!.modules.filter((module) => module.status === "completed").length,
  };
}

export function listAccountTracks(userId: string): AccountTrackSummary[] {
  const rows = database().prepare(`SELECT id, revision, updated_at, title, learning_track,
    profile_name, module_count, completed_count FROM account_tracks WHERE user_id = ? ORDER BY updated_at DESC, id DESC`).all(userId);
  return rows.map((row) => ({
    id: String(row.id), revision: Number(row.revision), updatedAt: String(row.updated_at),
    title: String(row.title), track: row.learning_track as AccountTrackSummary["track"],
    profileName: String(row.profile_name), moduleCount: Number(row.module_count), completedModuleCount: Number(row.completed_count),
  }));
}

export function createAccountTrack(userId: string, value: unknown, importKey?: string): AccountTrack {
  const state = validateAccountState(value), metadata = trackMetadata(state), id = randomUUID(), updatedAt = new Date().toISOString();
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (importKey) {
      const existing = db.prepare("SELECT track_id FROM account_track_imports WHERE user_id = ? AND import_key = ?").get(userId, importKey) as { track_id: string } | undefined;
      if (existing) {
        const track = readAccountTrack(userId, existing.track_id);
        db.exec("COMMIT");
        return track;
      }
    }
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM account_tracks WHERE user_id = ?").get(userId) as { count: number };
    if (count >= MAX_ACCOUNT_TRACKS)
      throw new AccountFailure(409, "TRACK_LIMIT", "Your account already has 100 learning paths. Delete an unused path before creating another.");
    db.prepare(`INSERT INTO account_tracks(id,user_id,plan_id,revision,state_json,title,learning_track,profile_name,module_count,completed_count,updated_at)
      VALUES (?,?,?,1,?,?,?,?,?,?,?)`).run(id, userId, state.plan!.id, JSON.stringify(state), metadata.title, metadata.track, metadata.profileName, metadata.moduleCount, metadata.completed, updatedAt);
    if (importKey) db.prepare("INSERT INTO account_track_imports(user_id, import_key, track_id) VALUES (?,?,?)").run(userId, importKey, id);
    db.exec("COMMIT");
    return { id, revision: 1, updatedAt, state };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function readAccountTrack(userId: string, id: string): AccountTrack {
  const row = database().prepare("SELECT id,revision,updated_at,state_json,plan_id FROM account_tracks WHERE user_id = ? AND id = ?").get(userId, id) as TrackRow | undefined;
  if (!row) throw new AccountFailure(404, "NOT_FOUND", "This learning path was not found in your account.");
  return trackState(row);
}

export function validateTrackRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new AccountFailure(400, "INVALID_INPUT", "Include the saved learning path revision.");
  return value;
}

export function updateAccountTrack(userId: string, id: string, value: unknown, revision: unknown): AccountTrack {
  const expectedRevision = validateTrackRevision(revision), state = validateAccountState(value), metadata = trackMetadata(state);
  const updatedAt = new Date().toISOString();
  const row = database().prepare(`UPDATE account_tracks SET revision=revision+1,state_json=?,title=?,learning_track=?,profile_name=?,module_count=?,completed_count=?,updated_at=?
    WHERE user_id=? AND id=? AND revision=? AND plan_id=? RETURNING id,revision,updated_at,state_json,plan_id`)
    .get(JSON.stringify(state), metadata.title, metadata.track, metadata.profileName, metadata.moduleCount, metadata.completed, updatedAt, userId, id, expectedRevision, state.plan!.id) as TrackRow | undefined;
  if (!row) {
    readAccountTrack(userId, id);
    throw new AccountFailure(409, "REVISION_CONFLICT", "This learning path changed in another tab. Reload it before saving to keep both versions safe.");
  }
  return trackState(row);
}

export function deleteAccountTrack(userId: string, id: string, revision: unknown): void {
  const expectedRevision = validateTrackRevision(revision);
  const result = database().prepare("DELETE FROM account_tracks WHERE user_id = ? AND id = ? AND revision = ?").run(userId, id, expectedRevision);
  if (Number(result.changes) !== 1) {
    readAccountTrack(userId, id);
    throw new AccountFailure(409, "REVISION_CONFLICT", "This learning path changed in another tab. Reload it before deleting it.");
  }
}
