import type { Lesson } from "@/lib/types";

export const MAX_STORED_LESSON_BYTES = 512 * 1024;

/** Stored teaching is separate from the compact context sent to bounded APIs. */
export function assertLessonRequestBudget(lesson: Lesson): void {
  const encoder = new TextEncoder();
  const lessonBytes = encoder.encode(JSON.stringify(lesson)).byteLength;
  if (lessonBytes > MAX_STORED_LESSON_BYTES)
    throw new Error("This course is too large to save safely. Your current course and scores are unchanged.");
}
