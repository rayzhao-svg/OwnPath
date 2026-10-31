/** Server-only AI boundary. Phase 1 always uses local mocks, even if a key exists.
 * Add a future Claude adapter here without changing routes or shared contracts.
 */
import type {
  ChatRequest,
  ChatResponse,
  Lesson,
  LessonRequest,
  LessonResponse,
  PlanRequest,
  PlanResponse,
} from "@/lib/types";
import {
  createMockPlan,
  createQuestions,
  getModuleContent,
} from "@/lib/mock-data";
import { ApiFailure } from "@/lib/validation";

export async function generatePlan({
  profile,
}: PlanRequest): Promise<PlanResponse> {
  return { plan: createMockPlan(profile), mode: "mock" };
}

export async function generateLesson({
  module,
}: LessonRequest): Promise<LessonResponse> {
  const content = getModuleContent(module.id);
  if (
    !content ||
    content.title !== module.title ||
    JSON.stringify(content.topics) !== JSON.stringify(module.topics)
  ) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Use a module returned by /api/plan. Its ID, title, and topics must match the mock catalog.",
    );
  }
  const lesson: Lesson = {
    id: `${module.id}-lesson`,
    moduleId: module.id,
    title: content.title,
    slides: [
      {
        id: `${module.id}-slide-1`,
        title: "The big picture",
        bullets: [
          content.description,
          `In this lesson: ${content.topics.join(", ")}.`,
          "Focus on understanding the idea, then put it into practice.",
        ],
        narration: `Welcome to ${content.title}. ${content.description} We will explore ${content.topics.join(", ")}. Take your time with the examples and use the tutor to revisit an idea.`,
      },
      {
        id: `${module.id}-slide-2`,
        title: content.topics[0],
        bullets: [content.takeaways[0], content.takeaways[1]],
        narration: `${content.takeaways[0]} ${content.takeaways[1]} Pause and think about where you have encountered these ideas in your own work.`,
      },
      {
        id: `${module.id}-slide-3`,
        title: "See it in practice",
        bullets: [content.example, content.takeaways[2]],
        narration: `${content.example} ${content.takeaways[2]} The example is a starting point. Notice how each step connects to the question we are trying to answer.`,
      },
      {
        id: `${module.id}-slide-4`,
        title: "A common pitfall",
        bullets: [
          content.misconception,
          "Check your assumptions before relying on a result.",
        ],
        narration: `${content.misconception} When you apply the concept, make your assumptions explicit and check whether the evidence supports them.`,
      },
      {
        id: `${module.id}-slide-5`,
        title: "Make it your own",
        bullets: [
          content.practice,
          "Explain your reasoning in your own words.",
          "When you are ready, use the knowledge check to review your understanding.",
        ],
        narration: `${content.practice} Try the task independently, then explain why your approach works. The knowledge check will help you identify anything worth revisiting.`,
      },
    ],
    quiz: createQuestions(module.id, content),
  };
  return { lesson, mode: "mock" };
}

function contextualAnswer({ lesson, question }: ChatRequest): string {
  const query = question.toLowerCase();
  if (/example|practi[cs]e|apply|application/.test(query)) {
    const slide =
      lesson.slides.find((item) => /practice/i.test(item.title)) ??
      lesson.slides[Math.min(2, lesson.slides.length - 1)];
    return `Let's make “${lesson.title}” concrete. ${slide.bullets.join(" ")} Try describing the next step in your own words. This is a scripted mock response grounded in this lesson.`;
  }
  if (/quiz|test|assessment|pass|score/.test(query)) {
    return `The knowledge check reviews ${lesson.title.toLowerCase()} with ${lesson.quiz.length} questions. Choose an answer for every question, then submit. A score of at least 70% completes the module; with three questions you need all three correct. You can review explanations and retry. Answers and scoring are local and visible in this Phase 1 mock.`;
  }
  if (/pitfall|mistake|wrong|confus|misconception/.test(query)) {
    const slide =
      lesson.slides.find((item) => /pitfall/i.test(item.title)) ??
      lesson.slides[0];
    return `A useful point to revisit: ${slide.bullets.join(" ")} Which part of this idea would you like to connect to the example? This mock tutor can summarize the supplied lesson, but cannot evaluate new claims beyond it.`;
  }
  const words = query.match(/[a-z]{4,}/g) ?? [];
  const scored = lesson.slides.map((slide) => ({
    slide,
    score: words.reduce(
      (total, word) =>
        total +
        (`${slide.title} ${slide.bullets.join(" ")}`
          .toLowerCase()
          .includes(word)
          ? 1
          : 0),
      0,
    ),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best.score > 0 || /summari[sz]e|overview|explain|simple/.test(query)) {
    const slide =
      best.score > 0
        ? best.slide
        : lesson.slides[Math.min(1, lesson.slides.length - 1)];
    return `In this lesson, the key idea is: ${slide.bullets.join(" ")} To check your understanding, connect that idea to the worked example and explain one step aloud. This is a scripted lesson summary, rather than a live AI answer.`;
  }
  return `I can help you review “${lesson.title}” using the material here. ${lesson.slides[0].bullets[0]} Try asking for an example, a simpler explanation, or a common pitfall. This mock tutor stays within the supplied lesson and may not answer a more specific question.`;
}

export async function answerQuestion(
  request: ChatRequest,
): Promise<ChatResponse> {
  return {
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      content: contextualAnswer(request).slice(0, 4000),
    },
    mode: "mock",
  };
}
