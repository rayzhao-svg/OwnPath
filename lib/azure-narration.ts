import "server-only";

import { createHash } from "node:crypto";
import { ApiFailure } from "@/lib/validators";
import type { NarrationStatus } from "@/lib/types";

export const AMANDA_VOICE_ID = "en-US-AmandaMultilingualNeural";
export const AMANDA_VOICE_NAME = "Amanda Multilingual";
const FORMAT = "audio-24khz-96kbitrate-mono-mp3";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 20 * 1024 * 1024;
const CACHE_LIFETIME_MS = 10 * 60 * 1000;
const cache = new Map<string, { audio: ArrayBuffer; expires: number }>();
let cacheBytes = 0;

function configuration() {
  const key = process.env.AZURE_SPEECH_KEY?.trim() ?? "";
  const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase() ?? "";
  if (
    !key || key.length > 2048 || /[\r\n]/.test(key) ||
    /^(?:your(?:[_ -]|$)|replace(?:[_ -]|$)|placeholder|dummy|test-key)/i.test(key) ||
    !/^[a-z][a-z0-9]{1,39}$/.test(region) || /^(?:your|replace|placeholder)/i.test(region)
  ) return null;
  return { key, region };
}

export function getNarrationStatus(): NarrationStatus {
  return {
    available: configuration() !== null,
    voice: AMANDA_VOICE_NAME,
    voiceId: AMANDA_VOICE_ID,
  };
}

function xmlText(text: string) {
  // XML 1.0 excludes these controls and unpaired UTF-16 surrogates.
  return text.toWellFormed().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function escapeSsml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

function removeCached(key: string) {
  const entry = cache.get(key);
  if (entry) cacheBytes -= entry.audio.byteLength;
  cache.delete(key);
}

async function readAudio(response: Response): Promise<ArrayBuffer> {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "audio/mpeg" && contentType !== "application/octet-stream") {
    await response.body?.cancel();
    throw new Error("Unexpected synthesis output");
  }
  if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES || !response.body) {
    await response.body?.cancel();
    throw new Error("Synthesis output is unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error("Synthesis output is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Empty synthesis output");
  const audio = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio.buffer;
}

export async function synthesizeAmanda(text: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const config = configuration();
  if (!config) {
    throw new ApiFailure("INTERNAL_ERROR", "Amanda narration is not connected yet. Add the Azure Speech key and region in the server settings.", 503);
  }
  const narration = xmlText(text).trim();
  if (!narration || text.length > 5000) {
    throw new ApiFailure("VALIDATION_ERROR", "Narration text must contain 1–5000 characters.");
  }
  if (signal?.aborted) throw new ApiFailure("INTERNAL_ERROR", "Narration request was canceled.", 499);

  // Hash the credentials too: changing the resource never reuses its predecessor's cache.
  const cacheKey = createHash("sha256").update(JSON.stringify([config.region, config.key, AMANDA_VOICE_ID, narration])).digest("hex");
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expires <= now) removeCached(key);
  const cached = cache.get(cacheKey);
  if (cached) return cached.audio.slice(0);

  const timeout = AbortSignal.timeout(20_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": config.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": FORMAT,
        "User-Agent": "OwnPath",
      },
      body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${AMANDA_VOICE_ID}">${escapeSsml(narration)}</voice></speak>`,
      signal: combined,
      cache: "no-store",
    });
    if (!response.ok) {
      // Provider error bodies can contain account information; never forward or log them.
      void response.body?.cancel().catch(() => {});
      if (response.status === 429) {
        throw new ApiFailure("INTERNAL_ERROR", "Amanda narration is busy. Wait a moment and try again.", 429);
      }
      throw new ApiFailure("INTERNAL_ERROR", "Amanda narration could not be generated. Check the Speech service settings or try again.", 502);
    }
    const audio = await readAudio(response);
    combined.throwIfAborted();
    while (cache.size && (cache.size >= 32 || cacheBytes + audio.byteLength > MAX_CACHE_BYTES)) {
      removeCached(cache.keys().next().value!);
    }
    removeCached(cacheKey);
    cache.set(cacheKey, { audio, expires: Date.now() + CACHE_LIFETIME_MS });
    cacheBytes += audio.byteLength;
    return audio.slice(0);
  } catch (error) {
    if (signal?.aborted) throw new ApiFailure("INTERNAL_ERROR", "Narration request was canceled.", 499);
    if (timeout.aborted) throw new ApiFailure("INTERNAL_ERROR", "Amanda narration took too long. Please try again.", 504);
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure("INTERNAL_ERROR", "Amanda narration could not be generated. Please try again.", 502);
  }
}
