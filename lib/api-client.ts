import type {
  ApiError,
  ChatRequest,
  ChatResponse,
  LearnerProfile,
  Lesson,
  LessonRequest,
  LessonResponse,
  LessonDetailRequest,
  LessonDetailResponse,
  Module,
  PlanRequest,
  PlanResponse,
  QuizRefreshRequest,
  QuizRefreshResponse,
  QuizResult,
  ReviewRequest,
  ReviewResponse,
  StudyPlan,
  TutorMessage,
} from "@/lib/types";
import { assertLesson, assertStudyPlan } from "@/lib/validators";
import { assertQuizRefreshResponse, DEFAULT_QUIZ_QUESTION_COUNT, isQuizQuestionCount } from "@/lib/quiz-refresh";
import { AI_CLIENT_TIMEOUT_MS, AI_DETAIL_CLIENT_TIMEOUT_MS } from "@/lib/ai-budget";
import { assertReviewResponse, lessonForAttempt } from "@/lib/remediation";
import { compactLessonContext } from "@/lib/lesson-context";

async function post<TRequest, TResponse>(
  url: string,
  body: TRequest,
  signal?: AbortSignal,
  timeoutMs = AI_CLIENT_TIMEOUT_MS,
): Promise<TResponse> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: requestSignal,
      });
    } catch (error) {
      if (requestSignal.aborted || (error instanceof Error && /timeout|abort/i.test(error.name))) throw error;
      throw new Error("Could not reach OwnPath. Check your connection and try again.");
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (requestSignal.aborted) throw error;
      throw new Error(response.status === 504
        ? "The server took too long to respond. Please try again."
        : "The server returned an unreadable response. Please try again.");
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
  } catch (error) {
    // Navigation and an intentional background cancellation are not timeouts.
    if (signal?.aborted) throw signal.reason ?? new DOMException("Request canceled", "AbortError");
    if (deadline.signal.aborted || (error instanceof Error && error.name === "TimeoutError"))
      throw new Error("This request took too long. Please try again.");
    throw error;
  } finally {
    // The deadline covers reading JSON as well as receiving response headers.
    clearTimeout(timer);
  }
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
  const response = await post<typeof body, LessonResponse>("/api/lesson/detail", body, signal, AI_DETAIL_CLIENT_TIMEOUT_MS);
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

/** Fetch one substantial chapter without uploading the cached course again. */
export async function requestChapterDetailResponse(
  lesson: Lesson,
  module: Module,
  slideId: string,
  signal?: AbortSignal,
): Promise<LessonDetailResponse> {
  const original = lesson.slides.find((slide) => slide.id === slideId);
  if (!original) throw new Error("Choose a chapter from this course.");
  const outline = compactLessonContext(lesson, { maxBytes: 40 * 1024 });
  const body: LessonDetailRequest = { lesson: outline, module, slideId };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 60 * 1024)
    throw new Error("This chapter could not fit in a teaching request. Your saved course is unchanged.");
  const response = await post<LessonDetailRequest, LessonDetailResponse>("/api/lesson/detail", body, signal, AI_DETAIL_CLIENT_TIMEOUT_MS);
  assertMode(response?.mode);
  const chapterLesson = { ...outline, slides: [response?.slide] };
  assertLesson(chapterLesson);
  const chapter = response.slide;
  if (response.lessonId !== lesson.id || response.moduleId !== module.id ||
      chapter.id !== original.id || chapter.title !== original.title ||
      JSON.stringify(chapter.bullets) !== JSON.stringify(original.bullets) ||
      (original.learningObjective !== undefined && chapter.learningObjective !== original.learningObjective) ||
      (original.overview !== undefined && chapter.overview !== original.overview) ||
      (response.mode === "claude" && (chapter.teachingVersion !== 2 || chapter.qualityVersion !== 1)) || !chapter.scenes?.length)
    throw new Error("The detailed chapter did not match this course. Please try again.");
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
  const body: QuizRefreshRequest = { lesson: compactLessonContext(lesson), previousQuestions: previousQuestions.slice(-60), questionCount };
  const bytes = () => new TextEncoder().encode(JSON.stringify(body)).byteLength;
  while (body.previousQuestions.length && bytes() > 60 * 1024)
    body.previousQuestions = body.previousQuestions.slice(1);
  if (bytes() > 60 * 1024)
    throw new Error("This lesson is too large to create a new quiz. Try reloading the lesson.");
  const response = await post<QuizRefreshRequest, QuizRefreshResponse>(
    "/api/quiz", body, signal,
  );
  assertQuizRefreshResponse(response, lesson, previousQuestions, questionCount);
  return response;
}

export async function requestReviewResponse(
  lesson: Lesson,
  result: QuizResult,
  signal?: AbortSignal,
): Promise<ReviewResponse> {
  const attemptLesson = lessonForAttempt(lesson, result);
  const wireResult = { ...result };
  // The historical question set is already carried as this request's quiz.
  // Sending the same snapshot twice can crowd out a substantial chapter.
  if (JSON.stringify(wireResult.questions) === JSON.stringify(attemptLesson.quiz)) delete wireResult.questions;
  const body: ReviewRequest = { lesson: compactLessonContext(attemptLesson), result: wireResult };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 60 * 1024)
    throw new Error("This review could not fit in a request. Your score and saved course are unchanged.");
  const response = await post<ReviewRequest, ReviewResponse>("/api/review", body, signal);
  assertReviewResponse(response, lesson, result);
  return response;
}
export async function requestTutorResponse(
  lesson: Lesson,
  question: string,
  messages: TutorMessage[],
): Promise<ChatResponse> {
  const focus = /^\[OwnPath slide: ([^\]\r\n]{1,100})\]/.exec(question)?.[1];
  const body: ChatRequest = { lesson: compactLessonContext(lesson, { ...(focus ? { focusSlideIds: [focus] } : {}) }), question, messages: messages.slice(-20) };
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
