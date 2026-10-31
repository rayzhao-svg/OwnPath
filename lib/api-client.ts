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
  QuizRefreshRequest,
  QuizRefreshResponse,
  StudyPlan,
  TutorMessage,
} from "@/lib/types";
import { assertLesson, assertStudyPlan } from "@/lib/validators";
import { assertQuizRefreshResponse, DEFAULT_QUIZ_QUESTION_COUNT, isQuizQuestionCount } from "@/lib/quiz-refresh";

async function post<TRequest, TResponse>(
  url: string,
  body: TRequest,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
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
  return (await requestPlanResponse(profile)).plan;
}
export async function requestPlanResponse(profile: LearnerProfile): Promise<PlanResponse> {
  const response = await post<PlanRequest, PlanResponse>("/api/plan", { profile });
  assertMode(response?.mode);
  assertStudyPlan(response.plan);
  if (
    response.plan.profileId !== profile.id || response.plan.track !== profile.track ||
    response.plan.weeklyStudyHours !== profile.availableStudyTime
  )
    throw new Error("The curriculum did not match your profile. Please try again.");
  return response;
}
export async function requestLesson(module: Module): Promise<Lesson> {
  return (await requestLessonResponse(module)).lesson;
}
export async function requestLessonResponse(module: Module): Promise<LessonResponse> {
  const response = await post<LessonRequest, LessonResponse>("/api/lesson", { module });
  assertMode(response?.mode);
  assertLesson(response.lesson);
  if (response.lesson.moduleId !== module.id || response.lesson.title !== module.title)
    throw new Error("The lesson did not match this module. Please try again.");
  return response;
}

export async function requestLessonDetailResponse(
  lesson: Lesson,
  module: Module,
  signal?: AbortSignal,
): Promise<LessonResponse> {
  const body = { lesson, module };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 60 * 1024)
    throw new Error("This saved lesson is too large to expand. You can continue with its existing explanation.");
  const response = await post<typeof body, LessonResponse>("/api/lesson/detail", body, signal, 55_000);
  assertMode(response?.mode);
  assertLesson(response.lesson);
  if (response.lesson.id !== lesson.id || response.lesson.moduleId !== lesson.moduleId ||
      response.lesson.moduleId !== module.id || response.lesson.title !== lesson.title ||
      response.lesson.title !== module.title || response.lesson.slides.length !== lesson.slides.length ||
      response.lesson.slides.some((slide, index) => slide.id !== lesson.slides[index].id ||
        slide.title !== lesson.slides[index].title ||
        JSON.stringify(slide.bullets) !== JSON.stringify(lesson.slides[index].bullets) ||
        !slide.scenes?.length) || JSON.stringify(response.lesson.quiz) !== JSON.stringify(lesson.quiz))
    throw new Error("The expanded explanation did not match this saved lesson. Please try again.");
  return response;
}
export async function requestTutor(
  lesson: Lesson,
  question: string,
  messages: TutorMessage[],
): Promise<TutorMessage> {
  return (await requestTutorResponse(lesson, question, messages)).message;
}

export async function requestQuizRefreshResponse(
  lesson: Lesson,
  previousQuestions: string[],
  questionCount = DEFAULT_QUIZ_QUESTION_COUNT,
  signal?: AbortSignal,
): Promise<QuizRefreshResponse> {
  if (!isQuizQuestionCount(questionCount))
    throw new Error("Choose a whole number of questions between 5 and 10.");
  const body: QuizRefreshRequest = { lesson, previousQuestions: previousQuestions.slice(-60), questionCount };
  const bytes = () => new TextEncoder().encode(JSON.stringify(body)).byteLength;
  while (body.previousQuestions.length && bytes() > 60 * 1024)
    body.previousQuestions = body.previousQuestions.slice(1);
  if (bytes() > 60 * 1024)
    throw new Error("This lesson is too large to create a new quiz. Try reloading the lesson.");
  const response = await post<QuizRefreshRequest, QuizRefreshResponse>(
    "/api/quiz", body, signal, 55_000,
  );
  assertQuizRefreshResponse(response, lesson, previousQuestions, questionCount);
  return response;
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
