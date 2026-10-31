import { generateLessonDetail } from "@/lib/lesson-detail";
import type { LessonDetailRequest } from "@/lib/types";
import { ApiFailure, assertLesson, assertModule, errorResponse, readJsonBody } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function parseRequest(value: unknown): LessonDetailRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiFailure("VALIDATION_ERROR", "Provide this lesson and its module.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["lesson", "module", "slideId"].includes(key)) ||
      !Object.hasOwn(body, "lesson") || !Object.hasOwn(body, "module"))
    throw new ApiFailure("VALIDATION_ERROR", "The lesson detail request contains unsupported fields.");
  assertLesson(body.lesson);
  assertModule(body.module);
  if (body.lesson.moduleId !== body.module.id || body.lesson.title !== body.module.title)
    throw new ApiFailure("VALIDATION_ERROR", "The lesson must belong to this module.");
  if (body.slideId !== undefined && (typeof body.slideId !== "string" ||
      !body.lesson.slides.some((slide) => slide.id === body.slideId)))
    throw new ApiFailure("VALIDATION_ERROR", "Choose a chapter from this course.");
  if (body.slideId === undefined && body.lesson.slides.length > 8)
    throw new ApiFailure("VALIDATION_ERROR", "This lesson has too many chapters to expand at once.");
  return { lesson: body.lesson, module: body.module, ...(typeof body.slideId === "string" ? { slideId: body.slideId } : {}) };
}

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const target = new URL(`${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`);
    const origin = request.headers.get("origin");
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash ||
        (origin && origin !== target.origin) || request.headers.get("sec-fetch-site") === "cross-site")
      throw new ApiFailure("VALIDATION_ERROR", "Expand lessons from this app.", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      throw new ApiFailure("VALIDATION_ERROR", "Lesson detail requests must use application/json.", 415);
    const input = parseRequest(await readJsonBody(request));
    if (request.signal.aborted) throw new ApiFailure("INTERNAL_ERROR", "Lesson expansion was canceled.", 499);
    const response = await generateLessonDetail(input, request.signal);
    if (request.signal.aborted) throw new ApiFailure("INTERNAL_ERROR", "Lesson expansion was canceled.", 499);
    return Response.json(response, { headers });
  } catch (error) {
    const response = errorResponse(error instanceof ApiFailure ? error : new ApiFailure("INTERNAL_ERROR", "The detailed lesson could not be created. Please try again.", 502));
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}
