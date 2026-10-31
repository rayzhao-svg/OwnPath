import type {
  ApiError,
  ChatRequest,
  ChatResponse,
  LearnerProfile,
  Lesson,
  LessonRequest,
  LessonResponse,
  Module,
  PlanRequest,
  PlanResponse,
  StudyPlan,
  TutorMessage,
} from "@/lib/types";
import { assertLesson } from "@/lib/validators";

async function post<TRequest, TResponse>(
  url: string,
  body: TRequest,
): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && /timeout|abort/i.test(error.name)
        ? "This request took too long. Please try again."
        : "Could not reach OwnPath. Check your connection and try again.",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Please try again.");
  }
  if (!response.ok) {
    const error = data as Partial<ApiError> | null;
    const message = error?.error?.message;
    throw new Error(
      typeof message === "string" && message.trim()
        ? message
        : "Something went wrong. Please try again.",
    );
  }
  return data as TResponse;
}

function assertMode(mode: unknown): asserts mode is "mock" | "claude" {
  if (mode !== "mock" && mode !== "claude")
    throw new Error("The server returned an unreadable response. Please try again.");
}

export async function requestPlan(profile: LearnerProfile): Promise<StudyPlan> {
  return (await post<PlanRequest, PlanResponse>("/api/plan", { profile })).plan;
}
export async function requestLesson(module: Module): Promise<Lesson> {
  return (await requestLessonResponse(module)).lesson;
}
export async function requestLessonResponse(module: Module): Promise<LessonResponse> {
  const response = await post<LessonRequest, LessonResponse>("/api/lesson", { module });
  assertMode(response?.mode);
  assertLesson(response.lesson);
  if (response.lesson.moduleId !== module.id)
    throw new Error("The lesson did not match this module. Please try again.");
  return response;
}
export async function requestTutor(
  lesson: Lesson,
  question: string,
  messages: TutorMessage[],
): Promise<TutorMessage> {
  return (await requestTutorResponse(lesson, question, messages)).message;
}
export async function requestTutorResponse(
  lesson: Lesson,
  question: string,
  messages: TutorMessage[],
): Promise<ChatResponse> {
  const body: ChatRequest = { lesson, question, messages: messages.slice(-20) };
  // Leave room beneath the endpoint's 64 KiB limit, including UTF-8 text.
  const bytes = () => new TextEncoder().encode(JSON.stringify(body)).byteLength;
  while (body.messages.length && bytes() > 60 * 1024)
    body.messages = body.messages.slice(2);
  if (bytes() > 60 * 1024)
    throw new Error("This lesson is too large to send to the tutor. Try a shorter question.");
  const response = await post<ChatRequest, ChatResponse>("/api/chat", body);
  assertMode(response?.mode);
  const message = response.message;
  if (
    !message || typeof message.id !== "string" || !message.id.trim() ||
    message.id.length > 100 || message.role !== "assistant" ||
    typeof message.content !== "string" || !message.content.trim() ||
    message.content.length > 4000
  )
    throw new Error("The tutor returned an unreadable answer. Please try again.");
  return response;
}
