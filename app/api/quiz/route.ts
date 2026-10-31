import { generateQuizRefresh } from "@/lib/quiz-generation";
import type { QuizRefreshRequest } from "@/lib/types";
import { DEFAULT_QUIZ_QUESTION_COUNT, isQuizQuestionCount } from "@/lib/quiz-refresh";
import { ApiFailure, assertLesson, errorResponse, readJsonBody } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function parseRequest(value: unknown): QuizRefreshRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiFailure("VALIDATION_ERROR", "Provide the lesson to create new questions.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["lesson", "previousQuestions", "questionCount"].includes(key)) ||
      !Object.hasOwn(body, "lesson") || !Object.hasOwn(body, "previousQuestions"))
    throw new ApiFailure("VALIDATION_ERROR", "The quiz request contains unsupported fields.");
  assertLesson(body.lesson);
  if (!Array.isArray(body.previousQuestions) || body.previousQuestions.length > 60 ||
      body.previousQuestions.some((question) => typeof question !== "string" || !question.trim() || question.length > 2000))
    throw new ApiFailure("VALIDATION_ERROR", "The earlier questions must contain at most 60 bounded question texts.");
  const questionCount = Object.hasOwn(body, "questionCount") ? body.questionCount : DEFAULT_QUIZ_QUESTION_COUNT;
  if (!isQuizQuestionCount(questionCount))
    throw new ApiFailure("VALIDATION_ERROR", "Choose a whole number of questions between 5 and 10.");
  return { lesson: body.lesson, previousQuestions: (body.previousQuestions as string[]).map((question) => question.trim()), questionCount };
}

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const target = new URL(`${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`);
    const origin = request.headers.get("origin");
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash ||
        (origin && origin !== target.origin) || request.headers.get("sec-fetch-site") === "cross-site")
      throw new ApiFailure("VALIDATION_ERROR", "Create quiz questions from this app.", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      throw new ApiFailure("VALIDATION_ERROR", "Quiz requests must use application/json.", 415);
    const input = parseRequest(await readJsonBody(request));
    if (request.signal.aborted) throw new ApiFailure("INTERNAL_ERROR", "Question generation was canceled.", 499);
    const response = await generateQuizRefresh(input);
    if (request.signal.aborted) throw new ApiFailure("INTERNAL_ERROR", "Question generation was canceled.", 499);
    return Response.json(response, { headers });
  } catch (error) {
    const response = errorResponse(error instanceof ApiFailure ? error : new ApiFailure("INTERNAL_ERROR", "New questions could not be generated. Please try again.", 502));
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}
