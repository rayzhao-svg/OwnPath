import {
  extractResumeProfile,
  MAX_RESUME_BYTES,
  readableResumeText,
  readResumeFile,
  ResumeError,
} from "@/lib/resume";

export const runtime = "nodejs";
export const maxDuration = 30;

async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) throw new ResumeError("Resume files must be at most 2 MB; pasted text must be at most 16,000 characters.", 413);
  if (!request.body) throw new ResumeError("Choose a resume or paste its text.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 8_000);
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (request.signal.aborted || timedOut) throw new ResumeError("Resume upload timed out. Please try again.", 408);
      const chunk = await reader.read();
      if (request.signal.aborted || timedOut) throw new ResumeError("Resume upload timed out. Please try again.", 408);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new ResumeError("Resume files must be at most 2 MB; pasted text must be at most 16,000 characters.", 413);
      chunks.push(chunk.value);
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(28_000)]);
  try {
    const origin = request.headers.get("origin");
    // NextURL normalizes loopback addresses to localhost. Bind the browser's
    // origin to the actual HTTP Host instead, while keeping the server's
    // protocol and ignoring untrusted forwarded-host headers.
    const requestUrl = new URL(request.url);
    const target = new URL(`${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`);
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash ||
      (origin && origin !== target.origin) || request.headers.get("sec-fetch-site") === "cross-site")
      throw new ResumeError("Upload resumes from the OwnPath onboarding page.", 403);
    if (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity")
      throw new ResumeError("Compressed resume requests are not supported.", 415);
    const contentType = request.headers.get("content-type") ?? "";
    const isJson = /^application\/json(?:\s*;|$)/i.test(contentType);
    if (!isJson && !/^multipart\/form-data(?:\s*;|$)/i.test(contentType))
      throw new ResumeError("Send a PDF/TXT file or pasted resume text.", 415);
    const bytes = await boundedBody(request, isJson ? 96 * 1024 : MAX_RESUME_BYTES + 16 * 1024);
    let text: string;
    let useClaude = false;
    if (isJson) {
      let value: unknown;
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
      catch { throw new ResumeError("The resume request could not be read. Please try again."); }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResumeError("Paste readable resume text.");
      const fields = value as Record<string, unknown>;
      if (Object.keys(fields).some((key) => !["text", "useClaude"].includes(key)) ||
        (fields.useClaude !== undefined && typeof fields.useClaude !== "boolean"))
        throw new ResumeError("The resume request contains unsupported fields.");
      text = readableResumeText(fields.text);
      useClaude = fields.useClaude === true;
    } else {
      let form: FormData;
      try { form = await new Response(Uint8Array.from(bytes).buffer, { headers: { "Content-Type": contentType } }).formData(); }
      catch { throw new ResumeError("The upload could not be read. Choose a PDF or TXT file again."); }
      const file = form.get("file");
      if (!(file instanceof File) || form.getAll("file").length !== 1 ||
        [...form.keys()].some((key) => !["file", "useClaude"].includes(key)) || form.getAll("useClaude").length > 1 ||
        (form.has("useClaude") && !["true", "false"].includes(String(form.get("useClaude")))))
        throw new ResumeError("Upload one PDF or TXT resume at a time.");
      useClaude = form.get("useClaude") === "true";
      text = await readResumeFile(file, signal);
    }
    return Response.json(await extractResumeProfile(text, useClaude, signal), { headers });
  } catch (error) {
    // Deliberately avoid the shared error logger: parser errors may carry PII.
    const safe = error instanceof ResumeError ? error : new ResumeError("The resume could not be processed. Try TXT or paste its text.", 422);
    return Response.json({ error: { code: safe.status === 413 ? "PAYLOAD_TOO_LARGE" : "RESUME_ERROR", message: safe.message } }, { status: safe.status, headers });
  }
}
