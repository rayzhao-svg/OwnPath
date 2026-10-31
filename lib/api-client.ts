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

async function post<TRequest, TResponse>(
  url: string,
  body: TRequest,
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as Partial<ApiError>;
    throw new Error(
      error.error?.message || "Something went wrong. Please try again.",
    );
  }
  return data as TResponse;
}

export async function requestPlan(profile: LearnerProfile): Promise<StudyPlan> {
  return (await post<PlanRequest, PlanResponse>("/api/plan", { profile })).plan;
}
export async function requestLesson(module: Module): Promise<Lesson> {
  return (await post<LessonRequest, LessonResponse>("/api/lesson", { module }))
    .lesson;
}
export async function requestTutor(
  lesson: Lesson,
  question: string,
  messages: TutorMessage[],
): Promise<TutorMessage> {
  return (
    await post<ChatRequest, ChatResponse>("/api/chat", {
      lesson,
      question,
      messages,
    })
  ).message;
}
