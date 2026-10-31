import { assertAttemptForLesson, assertReviewResponse } from "@/lib/remediation";
import { assertLesson, assertProfile, assertQuizResult, assertStudyPlan } from "@/lib/validators";
import type { LearningState, Lesson, PlanResponse, QuizQuestion, QuizResult, SavedRemediation, StudyPlan } from "@/lib/types";

export const EMPTY_STATE: LearningState = {
  version: 1,
  profile: null,
  plan: null,
  lessons: {},
  quizResults: {},
  lessonModes: {},
  latestQuizResults: {},
  quizHistory: {},
  remediations: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function knownMode(value: unknown): value is PlanResponse["mode"] {
  return value === "mock" || value === "claude";
}

/** Stable prerequisite order also supports older valid, unordered saved plans. */
export function orderPlan(plan: StudyPlan): StudyPlan {
  const byId = new Map(plan.modules.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const ordered: StudyPlan["modules"] = [];
  function add(id: string) {
    if (seen.has(id)) return;
    const item = byId.get(id)!;
    item.prerequisites.forEach(add);
    seen.add(id);
    ordered.push(item);
  }
  plan.modules.forEach((item) => add(item.id));
  return { ...plan, modules: ordered };
}

/** Completion is monotonic; only a passing assessment adds new completion. */
export function reconcileProgress(plan: StudyPlan, results: LearningState["quizResults"]): StudyPlan {
  const completed = new Set(plan.modules
    .filter((item) => item.status === "completed" || results[item.id]?.passed)
    .map((item) => item.id));
  return orderPlan({
    ...plan,
    modules: plan.modules.map((item) => ({
      ...item,
      status: completed.has(item.id) ? "completed"
        : !item.prerequisites.every((id) => completed.has(id)) ? "locked"
        : item.status === "in-progress" ? "in-progress" : "not-started",
    })),
  });
}

export function attemptKey(result: QuizResult): string {
  const answers = Object.entries(result.answers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([result.lessonId, result.completedAt, result.score, answers]);
}

export function copyQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return questions.map((question) => ({ ...question, options: [...question.options] }));
}

export function sameQuestions(left: QuizQuestion[], right: QuizQuestion[]): boolean {
  return left.length === right.length && left.every((question, index) => {
    const other = right[index];
    return question.id === other.id && question.question === other.question &&
      question.correctAnswer === other.correctAnswer && question.explanation === other.explanation &&
      question.options.length === other.options.length && question.options.every((option, optionIndex) => option === other.options[optionIndex]);
  });
}

export function snapshotAttempt(result: QuizResult, lesson: Lesson): QuizResult {
  if (result.questions || result.lessonId !== lesson.id) return result;
  try {
    assertAttemptForLesson(lesson, result);
    return { ...result, questions: copyQuestions(lesson.quiz) };
  } catch {
    // Historical scores from a replaced lesson remain progress, not current diagnostics.
    return result;
  }
}

function restoreParsedState(value: unknown): LearningState | null {
  if (
    !isRecord(value) || value.version !== 1 ||
    !isRecord(value.profile) || !isRecord(value.plan) ||
    !isRecord(value.lessons) || !isRecord(value.quizResults)
  ) return null;
  const profile = value.profile;
  const plan = value.plan;
  assertProfile(profile);
  assertStudyPlan(plan);
  if (plan.profileId !== profile.id || plan.track !== profile.track ||
      plan.weeklyStudyHours !== profile.availableStudyTime) return null;
  const byId = new Map(plan.modules.map((item) => [item.id, item]));
  const lessons: Record<string, Lesson> = {};
  const quizResults: Record<string, QuizResult> = {};
  const latestQuizResults: Record<string, QuizResult> = {};
  const quizHistory: Record<string, QuizResult[]> = {};
  const remediations: Record<string, SavedRemediation> = {};
  const lessonModes: NonNullable<LearningState["lessonModes"]> = {};
  // Optional caches fail independently, so an outdated review cannot erase a path.
  for (const [id, cached] of Object.entries(value.lessons)) {
    try {
      assertLesson(cached);
      const learningModule = byId.get(id);
      if (learningModule && cached.moduleId === id && cached.title === learningModule.title)
        lessons[id] = cached;
    } catch { /* An outdated lesson can be regenerated. */ }
  }
  const hasLatestResults = isRecord(value.latestQuizResults);
  function savedAttempt(id: string, cached: unknown, current = false): QuizResult | null {
    try {
      let result: QuizResult;
      try {
        assertQuizResult(cached);
        result = cached;
      } catch {
        if (current || !isRecord(cached) || cached.questions === undefined) return null;
        // A damaged optional question snapshot cannot erase a valid historical
        // grade. Keep only its independently validated score, without diagnostics.
        const scoreOnly = Object.fromEntries(Object.entries(cached)
          .filter(([key]) => !["questions", "answers", "missedQuestionIds"].includes(key)));
        assertQuizResult(scoreOnly);
        result = scoreOnly;
      }
      if (!byId.has(id) || result.moduleId !== id) return null;
      const lesson = lessons[id];
      // Historical best results survive a regenerated lesson; current diagnostics
      // must still agree with the actual questions and answers.
      if (current) {
        if (!lesson) return null;
        assertAttemptForLesson(lesson, result);
      } else if (!hasLatestResults && lesson?.id === result.lessonId && lesson.quiz.length === result.totalQuestions)
        assertAttemptForLesson(lesson, result);
      return result;
    } catch { return null; }
  }
  for (const [id, cached] of Object.entries(value.quizResults)) {
    const result = savedAttempt(id, cached);
    if (result) quizResults[id] = result;
  }
  if (isRecord(value.quizHistory)) {
    for (const [id, cached] of Object.entries(value.quizHistory)) {
      if (!byId.has(id) || !Array.isArray(cached)) continue;
      const attempts = cached.map((item) => savedAttempt(id, item))
        .filter((item): item is QuizResult => item !== null);
      if (attempts.length) quizHistory[id] = attempts;
    }
  }
  if (isRecord(value.latestQuizResults)) {
    for (const [id, cached] of Object.entries(value.latestQuizResults)) {
      const result = savedAttempt(id, cached, true);
      if (result) latestQuizResults[id] = result;
    }
  }
  for (const id of byId.keys()) {
    const candidates = [...(quizHistory[id] ?? []),
      ...(quizResults[id] ? [quizResults[id]] : []),
      ...(latestQuizResults[id] ? [latestQuizResults[id]] : [])];
    if (!candidates.length) continue;
    const unique = new Map(candidates.map((item) => [attemptKey(item), item]));
    const attempts = [...unique.values()].sort((a, b) =>
      Date.parse(a.completedAt) - Date.parse(b.completedAt));
    quizHistory[id] = attempts;
    quizResults[id] = candidates.reduce((best, item) => item.score > best.score ? item : best);
    // An explicit empty latest-results map records a replaced lesson. Only legacy
    // stores without that map may promote their historical best into diagnostics.
    if (!hasLatestResults) latestQuizResults[id] = attempts[attempts.length - 1];
  }
  if (isRecord(value.remediations)) {
    for (const [id, cached] of Object.entries(value.remediations)) {
      try {
        const result = latestQuizResults[id];
        const lesson = lessons[id];
        if (!lesson || !result) continue;
        assertReviewResponse(cached, lesson, result);
        const reviewedAt = isRecord(cached) ? cached.reviewedAt : undefined;
        remediations[id] = {
          review: cached.review,
          mode: cached.mode,
          ...(cached.fallbackReason ? { fallbackReason: cached.fallbackReason } : {}),
          ...(typeof reviewedAt === "string" && Number.isFinite(Date.parse(reviewedAt))
            ? { reviewedAt } : {}),
        };
      } catch { /* A stale or invalid review can be generated again. */ }
    }
  }
  if (isRecord(value.lessonModes)) {
    for (const [id, mode] of Object.entries(value.lessonModes)) {
      if (lessons[id] && knownMode(mode)) lessonModes[id] = mode;
    }
  }
  return {
    version: 1, profile, plan: reconcileProgress(plan, quizResults), lessons,
    quizResults, latestQuizResults, quizHistory, remediations,
    ...(knownMode(value.planMode) ? { planMode: value.planMode } : {}),
    lessonModes,
    planGeneration: typeof value.planGeneration === "string" && value.planGeneration.length > 0 && value.planGeneration.length <= 100
      ? value.planGeneration : crypto.randomUUID(),
  };
}

export function restoreLearningState(raw: string): LearningState | null {
  return restoreParsedState(JSON.parse(raw) as unknown);
}

/** Shared server/browser boundary for persisted learning progress. */
export function parseLearningState(value: unknown): LearningState {
  const state = restoreParsedState(value);
  if (!state) throw new Error("Provide a valid saved learning path.");
  return state;
}
