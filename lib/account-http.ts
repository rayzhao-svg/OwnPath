import "server-only";

import { MAX_ACCOUNT_STATE_BYTES } from "@/lib/account-types";
import type { AccountUser } from "@/lib/account-types";
import { AccountFailure, findAccountSession, limitAccountAttempts } from "@/lib/account-store";

export const ACCOUNT_COOKIE = "ownpath_session";
const NO_STORE = { "Cache-Control": "private, no-store", "Vary": "Cookie, X-OwnPath-Account" };

export function accountJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function accountError(error: unknown): Response {
  if (error instanceof AccountFailure) {
    const response = accountJson({ error: { code: error.code, message: error.message } }, error.status);
    if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  // Never return SQLite errors, request bodies, credential details, or file paths.
  return accountJson({ error: { code: "INTERNAL_ERROR", message: "Your account could not be reached. Please try again. Your saved progress is unchanged." } }, 500);
}

export function accountCookie(request: Request): string | null {
  const value = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${ACCOUNT_COOKIE}=`));
  return value ? value.slice(ACCOUNT_COOKIE.length + 1) : null;
}

export function setAccountCookie(response: Response, token: string | null): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${ACCOUNT_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 30 * 24 * 60 * 60 : 0}${secure}`);
}

export function assertAccountOrigin(request: Request): void {
  const url = new URL(request.url);
  const target = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`);
  const origin = request.headers.get("origin");
  if (target.username || target.password || target.pathname !== "/" || target.search || target.hash ||
      (origin && origin !== target.origin) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new AccountFailure(403, "FORBIDDEN_ORIGIN", "Use your account from the OwnPath app.");
}

export function requireAccount(request: Request): AccountUser {
  const user = findAccountSession(accountCookie(request));
  if (!user) throw new AccountFailure(401, "UNAUTHENTICATED", "Sign in to access your saved learning paths.");
  const expected = request.headers.get("x-ownpath-account");
  if (!expected) throw new AccountFailure(400, "ACCOUNT_REQUIRED", "Include the account for this learning path request.");
  if (expected !== user.id)
    throw new AccountFailure(409, "ACCOUNT_CHANGED", "The signed-in account changed in another tab. Refresh before continuing; no progress was changed.");
  return user;
}

export function authRequestLimit(request: Request, kind: "login" | "register"): void {
  // The email-specific login window is enforced separately. A global ceiling
  // bounds expensive password derivations even when attacker-supplied IP headers
  // vary; a smaller address window helps ordinary accidental retry loops.
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 200) ?? "local";
  limitAccountAttempts("auth:global", 200);
  limitAccountAttempts(`${kind}:address:${address}`, kind === "login" ? 40 : 10);
}

export async function readAccountJson(request: Request, track = false): Promise<Record<string, unknown>> {
  assertAccountOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new AccountFailure(415, "UNSUPPORTED_MEDIA_TYPE", "Send account requests as JSON.");
  const maxBytes = track ? MAX_ACCOUNT_STATE_BYTES : 16 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new AccountFailure(413, "PAYLOAD_TOO_LARGE", track ? "This learning path exceeds the 8 MiB storage limit." : "The account request is too large.");
  if (!request.body) throw new AccountFailure(400, "INVALID_JSON", "Send a JSON request body.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new AccountFailure(413, "PAYLOAD_TOO_LARGE", track ? "This learning path exceeds the 8 MiB storage limit." : "The account request is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new AccountFailure(400, "INVALID_JSON", "Send a valid JSON object."); }
}

export function requireAccountFields(body: Record<string, unknown>, required: string[]): void {
  if (Object.keys(body).length !== required.length || required.some((key) => !Object.hasOwn(body, key)))
    throw new AccountFailure(400, "INVALID_INPUT", "The account request contains missing or unsupported fields.");
}

export function accountTrackId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new AccountFailure(404, "NOT_FOUND", "This learning path was not found in your account.");
  return value;
}

export function accountImportKey(request: Request): string | undefined {
  const value = request.headers.get("idempotency-key");
  if (value === null) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value))
    throw new AccountFailure(400, "INVALID_INPUT", "Include a valid learning path import identifier.");
  return value;
}
