import type { Lesson, Slide } from "@/lib/types";

export const DEFAULT_LESSON_CONTEXT_BYTES = 40 * 1024;

interface LessonContextOptions {
  focusSlideIds?: string[];
  maxBytes?: number;
}

/** Label a shortened source passage without presenting a cut sentence as complete. */
function excerpt(value: string, limit: number): string {
  const text = value.trim();
  if (text.length <= limit) return text;
  if (limit < 2) return "…";
  const prefix = text.slice(0, limit - 1);
  const boundary = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("\n"), prefix.lastIndexOf(" "));
  const end = boundary >= prefix.length * 0.7 ? boundary : prefix.length;
  return `${prefix.slice(0, end).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…`;
}

function teachingContext(slide: Slide, limit: number): string {
  if (!slide.scenes?.length) return excerpt(slide.narration, limit);
  if (limit < slide.scenes.length * 120)
    return excerpt(slide.overview ?? slide.bullets.join(" "), limit);
  const overview = slide.overview ? `${excerpt(slide.overview, Math.min(700, Math.floor(limit / 4)))}\n\n` : "";
  const perScene = Math.max(40, Math.floor((limit - overview.length) / slide.scenes.length));
  const sections = slide.scenes.map((scene) => {
    const visual = scene.visual.lines.join("\n");
    const complete = `${scene.title}\n${scene.narration}\n${visual}`;
    if (complete.length <= perScene) return complete;
    // Keep every teaching step, including later worked results and common
    // mistakes, instead of sending only the beginning of a long transcript.
    const available = Math.max(20, perScene - scene.title.length - 2);
    const visualLimit = Math.min(visual.length, Math.floor(available * 0.4));
    const narrationLimit = Math.max(10, available - visualLimit - 1);
    return `${scene.title}\n${excerpt(scene.narration, narrationLimit)}\n${excerpt(visual, visualLimit)}`;
  });
  return `${overview}${sections.join("\n\n")}`.trim();
}

/**
 * Project a stored course into bounded request context. Stable chapter outlines
 * and exact assessment questions survive; narration supplies source excerpts.
 * Full teaching scenes remain in browser persistence and are never mutated.
 */
export function compactLessonContext(lesson: Lesson, options: LessonContextOptions = {}): Lesson {
  const maxBytes = options.maxBytes ?? DEFAULT_LESSON_CONTEXT_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 1)
    throw new Error("Choose a positive lesson context budget.");
  const focused = new Set(options.focusSlideIds ?? []);
  const limits: number[] = lesson.slides.map((slide) => focused.has(slide.id) ? 28_000 : 2200);
  const minimums = lesson.slides.map((slide) => focused.has(slide.id) ? 1400 : 350);
  const project = (): Lesson => ({
    ...lesson,
    slides: lesson.slides.map((slide, index) => {
      const result = { ...slide, bullets: [...slide.bullets], narration: teachingContext(slide, limits[index]) };
      delete result.scenes;
      return result;
    }),
    // Questions and answer indices are never shortened to make room for text.
    quiz: lesson.quiz,
  });
  const encoder = new TextEncoder();
  let result = project();
  while (encoder.encode(JSON.stringify(result)).byteLength > maxBytes) {
    // Preserve the focused chapter's explanation before reducing it as a last
    // resort. Other chapter titles, objectives, bullets and overview stay exact.
    let reducible = limits.map((limit, index) => ({ limit, index }))
      .filter(({ limit, index }) => !focused.has(lesson.slides[index].id) && limit > minimums[index]);
    if (!reducible.length) reducible = limits.map((limit, index) => ({ limit, index }))
      .filter(({ limit, index }) => limit > minimums[index]);
    if (!reducible.length)
      throw new Error("This course outline and assessment are too large to send safely. Your saved course is unchanged.");
    for (const { limit, index } of reducible)
      limits[index] = Math.max(minimums[index], Math.floor(limit * 0.7));
    result = project();
  }
  return result;
}
