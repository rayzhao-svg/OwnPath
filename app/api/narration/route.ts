import { getNarrationStatus, synthesizeAmanda } from "@/lib/azure-narration";
import { ApiFailure, errorResponse, readJsonBody } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 30;

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  return Response.json(await getNarrationStatus(), { headers });
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    // NextURL normalizes loopback addresses to localhost; compare the actual
    // HTTP Host, as the resume route does, and ignore forwarded-host headers.
    const requestUrl = new URL(request.url);
    const target = new URL(`${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`);
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash ||
      (origin && origin !== target.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new ApiFailure("VALIDATION_ERROR", "Narration requests must come from this app.", 403);
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new ApiFailure("VALIDATION_ERROR", "Narration requests must use application/json.", 415);
    }
    const body = await readJsonBody(request);
    if (
      typeof body !== "object" || body === null || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !("text" in body) || typeof body.text !== "string" ||
      !body.text.trim() || body.text.length > 5000
    ) throw new ApiFailure("VALIDATION_ERROR", "Provide narration text containing 1–5000 characters.");
    const audio = await synthesizeAmanda(body.text, request.signal);
    return new Response(audio, { headers: { ...headers, "Content-Type": "audio/mpeg" } });
  } catch (error) {
    const safe = error instanceof ApiFailure
      ? error
      : new ApiFailure("INTERNAL_ERROR", "Amanda narration could not be generated. Please try again.", 502);
    const response = errorResponse(safe);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}
