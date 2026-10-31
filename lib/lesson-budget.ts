import type { Lesson } from "@/lib/types";

/** Leave space for quiz snapshots and request metadata under the 64 KiB API cap. */
export function assertLessonRequestBudget(lesson: Lesson): void {
  const encoder = new TextEncoder();
  const lessonBytes = encoder.encode(JSON.stringify(lesson)).byteLength;
  const quizBytes = encoder.encode(JSON.stringify(lesson.quiz)).byteLength;
  if (lessonBytes > 48 * 1024 || lessonBytes + quizBytes > 56 * 1024)
    throw new Error("The combined lesson and questions are too long to save safely. Your current lesson and scores are unchanged. Please try generating a shorter question set.");
}
