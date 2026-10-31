import "server-only";

import { createHash } from "node:crypto";
import { AI_DETAIL_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS } from "@/lib/ai-budget";
import { ApiFailure } from "@/lib/validators";

const PROVIDER_LIMIT = 128 * 1024;
const inFlight = new Map<string, Promise<unknown>>();

export function aiGenerationFailure(message = "AI generation is unavailable. Please try again, or check the server API key and connection."): ApiFailure {
  return new ApiFailure("INTERNAL_ERROR", message, 500);
}

interface ClaudeJsonOptions {
  system: string;
  payload: unknown;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs?: number;
  effort?: "low" | "medium";
  signal?: AbortSignal;
}

function providerFailure(status: number): ApiFailure {
  if (status === 401 || status === 403)
    return aiGenerationFailure("Claude could not authenticate. Check the server API key and model access before trying again.");
  if (status === 402)
    return aiGenerationFailure("Claude billing is unavailable. Check the API account's credits and billing before trying again.");
  if (status === 429)
    return aiGenerationFailure("Claude is receiving too many requests. Wait a moment before trying again.");
  return aiGenerationFailure();
}

function retryDelay(response: Response): number | null {
  if (![429, 500, 502, 503, 504, 529].includes(response.status)) return null;
  const header = response.headers.get("retry-after");
  const seconds = header === null ? NaN : Number(header);
  const delay = header === null ? 300 : Number.isFinite(seconds)
    ? seconds * 1000 : Date.parse(header) - Date.now();
  // Never retry ahead of the provider's requested delay or hold a long queue.
  return Number.isFinite(delay) && delay <= 2000 ? Math.max(0, delay) : null;
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > PROVIDER_LIMIT) {
    await response.body?.cancel();
    throw new Error("Provider response unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PROVIDER_LIMIT) throw new Error("Provider response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const envelope: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope))
    throw new Error("Invalid provider envelope");
  const message = envelope as Record<string, unknown>;
  const details = message.stop_details as { type?: unknown } | null | undefined;
  if (message.stop_reason !== "end_turn" || details?.type === "refusal" ||
      !Array.isArray(message.content) || message.content.length > 10)
    throw new Error("Incomplete provider response");
  const texts: string[] = [];
  for (const item of message.content) {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new Error("Invalid provider content");
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
    else if (block.type !== "thinking" && block.type !== "redacted_thinking")
      throw new Error("Unexpected provider content");
  }
  if (texts.length !== 1) throw new Error("Invalid provider text count");
  const result: unknown = JSON.parse(texts[0]);
  if (typeof result !== "object" || result === null || Array.isArray(result))
    throw new Error("Invalid structured output");
  return result;
}

async function send(key: string, body: string, timeoutMs: number, callerSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, AI_DETAIL_TIMEOUT_MS));
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", cache: "no-store", redirect: "error", signal,
        headers: {
          "Content-Type": "application/json", "anthropic-version": "2026-10-21",
          Authorization: `Bearer ${key}`,
        },
        body,
      });
      if (response.ok) return await readJson(response);
      const delay = attempt === 0 ? retryDelay(response) : null;
      await response.body?.cancel();
      if (delay === null) throw providerFailure(response.status);
      await waitForRetry(delay, signal);
    }
  } catch (error) {
    // Only failed HTTP responses are retried. A timeout or broken response may
    // already have generated billable content, so never replay it automatically.
    if (error instanceof ApiFailure) throw error;
    if (controller.signal.aborted)
      throw aiGenerationFailure("Claude took too long to respond. Your current work is saved; please try again in a moment.");
    throw aiGenerationFailure();
  } finally { controller.abort(); clearTimeout(timer); }
}

/** Share simultaneous identical work; completed learner responses are not cached. */
export async function requestClaudeJson({
  system, payload, schema, maxTokens, timeoutMs = AI_REQUEST_TIMEOUT_MS,
  effort = "medium", signal,
}: ClaudeJsonOptions): Promise<unknown | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key || key === "YOUR_API_KEY_HERE") return null;
  const body = JSON.stringify({
    model: "claude-sonnet-5-5", max_tokens: maxTokens,
    thinking: { type: "between_tools" },
    output_config: { effort, format: { type: "json_schema", schema } },
    system, messages: [{ role: "user", content: JSON.stringify(payload) }],
  });
  // A cancellable request owns its transport rather than canceling another caller.
  if (signal) return send(key, body, timeoutMs, signal);
  const id = createHash("sha256").update(key).update(body).update(String(timeoutMs)).digest("hex");
  const pending = inFlight.get(id);
  if (pending) return pending;
  const work = send(key, body, timeoutMs);
  inFlight.set(id, work);
  try { return await work; }
  finally { if (inFlight.get(id) === work) inFlight.delete(id); }
}
