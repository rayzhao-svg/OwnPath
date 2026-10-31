import type { Lesson, QuizQuestion, QuizRefreshResponse } from "@/lib/types";
import { ApiFailure, assertLesson } from "@/lib/validators";

export const QUIZ_QUESTION_COUNTS = [5, 6, 7, 8, 9, 10] as const;
export const DEFAULT_QUIZ_QUESTION_COUNT = 5;

export function isQuizQuestionCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 5 && value <= 10;
}

export function normalizeQuizQuestion(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const GENERIC_WORDS = new Set("a an and are as at be been being by can correct could did do does example for from has have how if in is it its lesson most of on or question should statement supported that the their these this to use using was were what when which why will with would you your".split(" "));
function terms(value: string): Set<string> {
  return new Set(normalizeQuizQuestion(value).split(" ").filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word)));
}

/** Validate both network quiz drafts and the saved lesson's new assessment. */
export function assertQuizRefreshResponse(
  value: unknown,
  lesson: Lesson,
  previousQuestions: readonly string[],
  questionCount = DEFAULT_QUIZ_QUESTION_COUNT,
): asserts value is QuizRefreshResponse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiFailure("VALIDATION_ERROR", "The new questions could not be read. Please try again.");
  const response = value as Record<string, unknown>;
  if (Object.keys(response).length !== 4 || response.lessonId !== lesson.id ||
      response.moduleId !== lesson.moduleId || (response.mode !== "claude" && response.mode !== "mock") ||
      !isQuizQuestionCount(questionCount) || !Array.isArray(response.quiz) || response.quiz.length !== questionCount)
    throw new ApiFailure("VALIDATION_ERROR", "The new questions did not match this lesson. Please try again.");
  assertLesson({ ...lesson, quiz: response.quiz });
  const questions = response.quiz as QuizQuestion[];
  const prior = new Set([...previousQuestions, ...lesson.quiz.map((question) => question.question)].map(normalizeQuizQuestion));
  const currentIds = new Set(lesson.quiz.map((question) => question.id));
  const sourceTerms = terms([lesson.title, ...lesson.slides.flatMap((slide) => [slide.title, ...slide.bullets, slide.narration])].join(" "));
  for (const question of questions) {
    const normalized = normalizeQuizQuestion(question.question);
    if (!normalized || prior.has(normalized) || currentIds.has(question.id))
      throw new ApiFailure("VALIDATION_ERROR", "These questions repeated an earlier assessment. Please try again.");
    prior.add(normalized);
    const options = question.options.map(normalizeQuizQuestion);
    if (question.question.length > 500 || question.options.length !== 4 ||
        question.options.some((option) => option.length > 250) || options.some((option) => !option) ||
        new Set(options).size !== 4 || question.explanation.length > 700)
      throw new ApiFailure("VALIDATION_ERROR", "The new questions were incomplete. Please try again.");
    const questionTerms = terms(`${question.question} ${question.options[question.correctAnswer]} ${question.explanation}`);
    if (![...questionTerms].some((word) => sourceTerms.has(word)))
      throw new ApiFailure("VALIDATION_ERROR", "The new questions were not grounded in this lesson. Please try again.");
  }
  const encoder = new TextEncoder();
  const quizBytes = encoder.encode(JSON.stringify(questions)).byteLength;
  const lessonBytes = encoder.encode(JSON.stringify({ ...lesson, quiz: questions })).byteLength;
  // Reviews send the teaching lesson and the attempt's question snapshot. Reserve
  // space for both plus result metadata beneath the shared 64 KiB request limit.
  if (encoder.encode(JSON.stringify(response)).byteLength > 24 * 1024 ||
      lessonBytes > 48 * 1024 || lessonBytes + quizBytes > 56 * 1024)
    throw new ApiFailure("VALIDATION_ERROR", "The new questions were too long. Please try again.");
}
