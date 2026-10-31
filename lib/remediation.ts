import type {
  Lesson,
  QuizMistake,
  QuizQuestion,
  QuizResult,
  ReviewRequest,
  ReviewResponse,
  Slide,
} from "@/lib/types";
import { ApiFailure, assertQuizResult } from "@/lib/validators";

function invalid(message: string): never {
  throw new ApiFailure("VALIDATION_ERROR", message);
}

/** Use an attempt's saved questions while keeping the original teaching slides. */
export function lessonForAttempt(lesson: Lesson, result: QuizResult): Lesson {
  assertQuizResult(result);
  const quiz = result.questions ?? lesson.quiz;
  if (result.lessonId !== lesson.id || result.moduleId !== lesson.moduleId || result.totalQuestions !== quiz.length)
    invalid("The quiz result must belong to this lesson.");
  return result.questions ? { ...lesson, quiz } : lesson;
}

/** Legacy results are still valid progress, but cannot identify missing answers. */
export function assertAttemptForLesson(
  lesson: Lesson,
  result: QuizResult,
  requireAnswers = false,
): void {
  lesson = lessonForAttempt(lesson, result);
  if (
    result.lessonId !== lesson.id || result.moduleId !== lesson.moduleId ||
    result.totalQuestions !== lesson.quiz.length
  ) invalid("The quiz result must belong to this lesson.");
  if (!result.answers) {
    if (requireAnswers) invalid("Answer every question before requesting a targeted review.");
    return;
  }
  const answers = result.answers;
  if (
    Object.keys(answers).length !== lesson.quiz.length ||
    lesson.quiz.some((question) =>
      !Object.hasOwn(answers, question.id) ||
      !Number.isInteger(answers[question.id]) ||
      answers[question.id] < 0 || answers[question.id] >= question.options.length,
    )
  ) invalid("Quiz answers must include exactly the questions and choices in this lesson.");
  const missed = lesson.quiz.filter((question) => answers[question.id] !== question.correctAnswer);
  if (lesson.quiz.length - missed.length !== result.correctAnswers)
    invalid("The quiz score does not match the submitted answers.");
  if (result.missedQuestionIds && (
    result.missedQuestionIds.length !== missed.length ||
    missed.some((question) => !result.missedQuestionIds!.includes(question.id))
  )) invalid("Missed questions must match the submitted answers.");
}

const STOP_WORDS = new Set(
  "about after again also and answer are before being below between both but can check choice choose correct could does each example first for from have how into its lesson more most must not only other our over per question should some than that the their them then there these they this those through under using was were what when where which while why will with would your".split(" "),
);
function words(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
    .filter((word) => !STOP_WORDS.has(word))
    .map((word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word));
}
function overlap(query: Set<string>, source: Set<string>): number {
  let score = 0;
  query.forEach((word) => { if (source.has(word)) score++; });
  return score;
}
function questionWords(question: QuizQuestion): Set<string> {
  return words(`${question.question} ${question.options[question.correctAnswer]} ${question.explanation}`);
}
function teachingPoint(slide: Slide, query: Set<string>): string {
  return slide.bullets.reduce((best, bullet) =>
    overlap(query, words(bullet)) > overlap(query, words(best)) ? bullet : best,
  );
}
function claimsCompletion(value: string): boolean {
  return /\b(?:mastered|mastery|you(?:['’]ve| have)?\s+(?:now\s+)?passed|(?:assessment|module)\s+(?:is\s+|has been\s+)?(?:passed|complete(?:d)?))\b/i.test(value);
}
function grounded(value: string, max: number): string {
  if (claimsCompletion(value))
    return "Revisit the lesson's reasoning and compare the choices before retrying.";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}
const GENERIC_TITLE = /^(?:the big picture|see it in practice|a common pitfall|make it your own|worked example|foundations|introduction|summary)$/i;

/** Associate each actual mistake with the closest supplied teaching context. */
export function diagnoseMistakes(lesson: Lesson, result: QuizResult): QuizMistake[] {
  lesson = lessonForAttempt(lesson, result);
  if (!result.answers) return [];
  const answers = result.answers;
  return lesson.quiz.filter((question) =>
    Object.hasOwn(answers, question.id) && answers[question.id] !== question.correctAnswer,
  ).map((question) => {
    const query = questionWords(question);
    const scores = lesson.slides.map((slide, index) => ({
      slide,
      index,
      score: overlap(query, words(slide.title)) * 4 +
        overlap(query, words(slide.bullets.join(" "))) * 2 +
        overlap(query, words(slide.narration)),
    }));
    scores.sort((a, b) => b.score - a.score || a.index - b.index);
    const slide = scores[0].slide;
    // A slide can teach several concepts beyond the one named in its heading.
    const titleWords = words(slide.title);
    const titleMatches = overlap(query, titleWords);
    const titleIsRelevant = !GENERIC_TITLE.test(slide.title) &&
      titleMatches > 0 && titleMatches / titleWords.size >= 0.5;
    const concept = grounded(titleIsRelevant ? slide.title : teachingPoint(slide, query), 200);
    return {
      questionId: question.id,
      selectedAnswer: answers[question.id],
      concept,
      slideId: slide.id,
    };
  });
}

/** No random IDs or timestamps: the same lesson and attempt give the same review. */
export function createMockReview({ lesson, result }: ReviewRequest): ReviewResponse {
  lesson = lessonForAttempt(lesson, result);
  assertAttemptForLesson(lesson, result, true);
  const mistakes = diagnoseMistakes(lesson, result);
  if (!mistakes.length) invalid("A targeted review needs at least one missed question.");
  return {
    mode: "mock",
    review: {
      lessonId: lesson.id,
      moduleId: lesson.moduleId,
      attemptedAt: result.completedAt,
      summary: "Focus on these missed concepts, then retry the knowledge check. Reviewing supports learning; a score of at least 70% is required to complete a module.",
      areas: mistakes.map((mistake) => {
        const question = lesson.quiz.find((item) => item.id === mistake.questionId)!;
        const slide = lesson.slides.find((item) => item.id === mistake.slideId)!;
        const selected = grounded(question.options[mistake.selectedAnswer], 350);
        const correct = grounded(question.options[question.correctAnswer], 600);
        const reason = grounded(question.explanation, 1600);
        const point = grounded(teachingPoint(slide, questionWords(question)), 500);
        return {
          questionId: question.id,
          concept: mistake.concept,
          slideId: slide.id,
          explanation: `Your answer was “${selected}”. The supported answer is “${correct}”. ${reason}`,
          workedExample: `Work through the missed question: ${grounded(question.question, 700)}\n1. Use the lesson's teaching point: ${point}\n2. Apply the reasoning: ${reason}\n3. This leads to “${correct}”. Compare that result with “${selected}” and explain the difference in your own words.`,
          steps: [
            `Revisit “${grounded(slide.title, 200)}” in the lecture. Read the explanation and connect it to this question.`,
            "Cover the answer, solve this example independently, and explain why the alternative you selected does not follow the lesson's reasoning.",
            "Try a similar example with one changed detail, then retry the knowledge check when you can explain each step.",
          ],
        };
      }),
    },
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || claimsCompletion(value))
    invalid(`${name} must be bounded educational text without unsupported completion claims.`);
}

/** Validate network and browser-cached reviews against the actual scored attempt. */
export function assertReviewResponse(
  value: unknown,
  lesson: Lesson,
  result: QuizResult,
): asserts value is ReviewResponse {
  lesson = lessonForAttempt(lesson, result);
  assertAttemptForLesson(lesson, result, true);
  const response = object(value, "reviewResponse");
  if (response.mode !== "mock" && response.mode !== "claude") invalid("Invalid review mode.");
  if (response.fallbackReason !== undefined && (
    response.fallbackReason !== "generation-failed" || response.mode !== "mock"
  )) invalid("Invalid review fallback status.");
  const review = object(response.review, "review");
  if (review.lessonId !== lesson.id || review.moduleId !== lesson.moduleId || review.attemptedAt !== result.completedAt)
    invalid("The review must match this lesson and quiz attempt.");
  text(review.summary, "review.summary", 600);
  const mistakes = diagnoseMistakes(lesson, result);
  if (!mistakes.length || !Array.isArray(review.areas) || review.areas.length !== mistakes.length)
    invalid("The review must cover exactly the missed questions.");
  const areas = review.areas as unknown[];
  const seen = new Set<string>();
  areas.forEach((value) => {
    const area = object(value, "review.area");
    const mistake = mistakes.find((item) => item.questionId === area.questionId);
    if (!mistake || seen.has(mistake.questionId) || area.slideId !== mistake.slideId || area.concept !== mistake.concept)
      invalid("Review concepts must reference the missed questions and their lesson context.");
    seen.add(mistake.questionId);
    text(area.explanation, "review.area.explanation", 3000);
    text(area.workedExample, "review.area.workedExample", 4000);
    if (!Array.isArray(area.steps) || area.steps.length < 2 || area.steps.length > 4)
      invalid("Each review area needs two to four actionable steps.");
    area.steps.forEach((step) => text(step, "review.area.step", 600));
  });
}
