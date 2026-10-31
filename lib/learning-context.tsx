"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createMockPlan, DEMO_PROFILE } from "@/lib/mock-data";
import { assertLessonRequestBudget } from "@/lib/lesson-budget";
import { assertAttemptForLesson, assertReviewResponse } from "@/lib/remediation";
import {
  assertLesson,
  assertProfile,
  assertQuizResult,
  assertStudyPlan,
} from "@/lib/validators";
import type {
  LearnerProfile,
  LearningState,
  Lesson,
  LessonResponse,
  PlanResponse,
  QuizQuestion,
  QuizResult,
  ReviewResponse,
  SavedRemediation,
  StudyPlan,
} from "@/lib/types";

const STORAGE_KEY = "ownpath:learning:v1";
const EMPTY_STATE: LearningState = {
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

interface LearningContextValue {
  state: LearningState;
  ready: boolean;
  storageWarning: string | null;
  setPlan: (profile: LearnerProfile, plan: StudyPlan, mode?: PlanResponse["mode"]) => void;
  saveLesson: (lesson: Lesson, mode?: LessonResponse["mode"], expectedPlanId?: string, expectedPlanGeneration?: string) => void;
  updateLessonTeaching: (lesson: Lesson, mode?: LessonResponse["mode"], expectedPlanId?: string, expectedPlanGeneration?: string) => void;
  replaceQuiz: (lessonId: string, moduleId: string, questions: QuizQuestion[], expectedPlanId?: string, expectedPlanGeneration?: string) => void;
  startModule: (moduleId: string, expectedPlanId?: string, expectedPlanGeneration?: string) => void;
  recordQuizResult: (result: QuizResult, expectedPlanId?: string, expectedPlanGeneration?: string) => void;
  saveRemediation: (response: ReviewResponse, expectedPlanId?: string, expectedPlanGeneration?: string, expectedResult?: QuizResult) => void;
  markRemediationReviewed: (moduleId: string, attemptedAt: string) => void;
  loadDemo: () => void;
}

const LearningContext = createContext<LearningContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function knownMode(value: unknown): value is PlanResponse["mode"] {
  return value === "mock" || value === "claude";
}

/** Stable prerequisite order also supports older valid, unordered saved plans. */
function orderPlan(plan: StudyPlan): StudyPlan {
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
function reconcileProgress(plan: StudyPlan, results: LearningState["quizResults"]): StudyPlan {
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

function attemptKey(result: QuizResult): string {
  const answers = Object.entries(result.answers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([result.lessonId, result.completedAt, result.score, answers]);
}

function copyQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return questions.map((question) => ({ ...question, options: [...question.options] }));
}

function sameQuestions(left: QuizQuestion[], right: QuizQuestion[]): boolean {
  return left.length === right.length && left.every((question, index) => {
    const other = right[index];
    return question.id === other.id && question.question === other.question &&
      question.correctAnswer === other.correctAnswer && question.explanation === other.explanation &&
      question.options.length === other.options.length && question.options.every((option, optionIndex) => option === other.options[optionIndex]);
  });
}

function snapshotAttempt(result: QuizResult, lesson: Lesson): QuizResult {
  if (result.questions || result.lessonId !== lesson.id) return result;
  try {
    assertAttemptForLesson(lesson, result);
    return { ...result, questions: copyQuestions(lesson.quiz) };
  } catch {
    // Historical scores from a replaced lesson remain progress, not current diagnostics.
    return result;
  }
}

function restoreState(raw: string): LearningState | null {
  const value: unknown = JSON.parse(raw);
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

export function LearningProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LearningState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Restore after hydration, keeping the server and first client render identical.
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const restored = restoreState(raw);
          if (restored) setState(restored);
          else
            setStorageWarning(
              "Your saved path could not be loaded. You can create a new one.",
            );
        }
      } catch {
        setStorageWarning(
          "Browser storage is unavailable or unreadable. You can keep learning in this tab.",
        );
      }
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !state.plan) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      queueMicrotask(() =>
        setStorageWarning(
          "Your browser could not save progress. Keep this tab open to continue.",
        ),
      );
    }
  }, [state, ready]);

  const setPlan = useCallback((profile: LearnerProfile, plan: StudyPlan, mode?: PlanResponse["mode"]) => {
    assertProfile(profile);
    assertStudyPlan(plan);
    if (plan.profileId !== profile.id || plan.track !== profile.track ||
        plan.weeklyStudyHours !== profile.availableStudyTime)
      throw new Error("The curriculum did not match your profile. Please try again.");
    setState({ ...EMPTY_STATE, profile, plan: orderPlan(plan), planGeneration: crypto.randomUUID(), ...(knownMode(mode) ? { planMode: mode } : {}) });
    setStorageWarning(null);
  }, []);
  const saveLesson = useCallback((lesson: Lesson, mode?: LessonResponse["mode"], expectedPlanId?: string, expectedPlanGeneration?: string) => {
    assertLesson(lesson);
    setState((previous) => {
      if (expectedPlanId && previous.plan?.id !== expectedPlanId) return previous;
      if (expectedPlanGeneration && previous.planGeneration !== expectedPlanGeneration) return previous;
      const target = previous.plan?.modules.find((item) => item.id === lesson.moduleId);
      if (!target || target.title !== lesson.title || target.status === "locked") return previous;
      const lessonModes = { ...previous.lessonModes };
      if (knownMode(mode)) lessonModes[lesson.moduleId] = mode;
      else delete lessonModes[lesson.moduleId];
      const latestQuizResults = { ...previous.latestQuizResults };
      const remediations = { ...previous.remediations };
      const latestResult = latestQuizResults[lesson.moduleId];
      const priorLesson = previous.lessons[lesson.moduleId];
      if ((priorLesson && JSON.stringify(priorLesson) !== JSON.stringify(lesson)) ||
          (latestResult && (latestResult.lessonId !== lesson.id || latestResult.totalQuestions !== lesson.quiz.length))) {
        delete latestQuizResults[lesson.moduleId];
        delete remediations[lesson.moduleId];
      }
      return {
        ...previous,
        lessons: { ...previous.lessons, [lesson.moduleId]: lesson },
        lessonModes,
        latestQuizResults,
        remediations,
      };
    });
  }, []);
  const updateLessonTeaching = useCallback((lesson: Lesson, mode?: LessonResponse["mode"], expectedPlanId?: string, expectedPlanGeneration?: string) => {
    try { assertLesson(lesson); }
    catch { return; }
    setState((previous) => {
      if (!previous.plan || (expectedPlanId && previous.plan.id !== expectedPlanId) ||
          (expectedPlanGeneration && previous.planGeneration !== expectedPlanGeneration)) return previous;
      const target = previous.plan.modules.find((item) => item.id === lesson.moduleId);
      const current = previous.lessons[lesson.moduleId];
      if (!target || target.status === "locked" || !current || current.id !== lesson.id ||
          current.title !== lesson.title || target.title !== lesson.title ||
          current.slides.length !== lesson.slides.length ||
          current.slides.some((slide, index) => slide.id !== lesson.slides[index].id ||
            slide.title !== lesson.slides[index].title ||
            JSON.stringify(slide.bullets) !== JSON.stringify(lesson.slides[index].bullets))) return previous;
      const slides = lesson.slides.map((slide) => ({
        id: slide.id,
        title: slide.title,
        narration: slide.narration,
        bullets: [...slide.bullets],
        ...(slide.overview ? { overview: slide.overview } : {}),
        ...(slide.learningObjective ? { learningObjective: slide.learningObjective } : {}),
        ...(slide.teachingVersion ? { teachingVersion: slide.teachingVersion } : {}),
        ...(slide.qualityVersion ? { qualityVersion: slide.qualityVersion } : {}),
        ...(slide.scenes ? { scenes: slide.scenes.map((scene) => ({
          ...scene, visual: { ...scene.visual, lines: [...scene.visual.lines] },
          ...(scene.lineNarrations ? { lineNarrations: [...scene.lineNarrations] } : {}),
        })) } : {}),
      }));
      const updated = { ...current, slides };
      try { assertLessonRequestBudget(updated); }
      catch { return previous; }
      if (JSON.stringify(current.slides) === JSON.stringify(slides)) return previous;
      return {
        ...previous,
        lessons: { ...previous.lessons, [lesson.moduleId]: updated },
        ...(knownMode(mode) ? { lessonModes: { ...previous.lessonModes, [lesson.moduleId]: mode } } : {}),
      };
    });
  }, []);
  const startModule = useCallback((moduleId: string, expectedPlanId?: string, expectedPlanGeneration?: string) => {
    setState((previous) => {
      if (!previous.plan) return previous;
      if (expectedPlanId && previous.plan.id !== expectedPlanId) return previous;
      if (expectedPlanGeneration && previous.planGeneration !== expectedPlanGeneration) return previous;
      const target = previous.plan.modules.find((m) => m.id === moduleId);
      if (!target || target.status !== "not-started") return previous;
      if (!target.prerequisites.every((id) => previous.plan!.modules.some((item) => item.id === id && item.status === "completed"))) return previous;
      return {
        ...previous,
        plan: {
          ...previous.plan,
          modules: previous.plan.modules.map((m) =>
            m.id === moduleId ? { ...m, status: "in-progress" } : m,
          ),
        },
      };
    });
  }, []);
  const replaceQuiz = useCallback((lessonId: string, moduleId: string, questions: QuizQuestion[], expectedPlanId?: string, expectedPlanGeneration?: string) => {
    setState((previous) => {
      if (!previous.plan || (expectedPlanId && previous.plan.id !== expectedPlanId) ||
          (expectedPlanGeneration && previous.planGeneration !== expectedPlanGeneration)) return previous;
      const target = previous.plan.modules.find((item) => item.id === moduleId);
      const lesson = previous.lessons[moduleId];
      if (!target || target.status === "locked" || !lesson || lesson.id !== lessonId ||
          !target.prerequisites.every((id) => previous.plan!.modules.some((item) => item.id === id && item.status === "completed"))) return previous;
      let replacement: Lesson;
      try {
        replacement = { ...lesson, quiz: copyQuestions(questions) };
        assertLesson(replacement);
        assertLessonRequestBudget(replacement);
      }
      catch { return previous; }
      if (sameQuestions(lesson.quiz, questions)) return previous;
      const best = previous.quizResults[moduleId];
      const latest = previous.latestQuizResults?.[moduleId];
      const history = previous.quizHistory?.[moduleId];
      return {
        ...previous,
        lessons: { ...previous.lessons, [moduleId]: replacement },
        quizResults: { ...previous.quizResults, ...(best ? { [moduleId]: snapshotAttempt(best, lesson) } : {}) },
        ...(previous.latestQuizResults ? {
          latestQuizResults: { ...previous.latestQuizResults, ...(latest ? { [moduleId]: snapshotAttempt(latest, lesson) } : {}) },
        } : {}),
        ...(previous.quizHistory ? {
          quizHistory: { ...previous.quizHistory, ...(history ? { [moduleId]: history.map((result) => snapshotAttempt(result, lesson)) } : {}) },
        } : {}),
      };
    });
  }, []);
  const recordQuizResult = useCallback((result: QuizResult, expectedPlanId?: string, expectedPlanGeneration?: string) => {
    assertQuizResult(result);
    setState((previous) => {
      if (!previous.plan) return previous;
      if (expectedPlanId && previous.plan.id !== expectedPlanId) return previous;
      if (expectedPlanGeneration && previous.planGeneration !== expectedPlanGeneration) return previous;
      const target = previous.plan.modules.find((item) => item.id === result.moduleId);
      if (!target || target.status === "locked") return previous;
      const currentLesson = previous.lessons[result.moduleId];
      if (!currentLesson) return previous;
      if (result.questions && !sameQuestions(result.questions, currentLesson.quiz)) return previous;
      try { assertAttemptForLesson(currentLesson, result); }
      catch { return previous; }
      if (!target.prerequisites.every((id) => previous.plan!.modules.some((item) => item.id === id && item.status === "completed"))) return previous;
      const priorResult = previous.quizResults[result.moduleId];
      const bestResult = priorResult && priorResult.score > result.score ? priorResult : result;
      const quizResults = { ...previous.quizResults, [result.moduleId]: bestResult };
      const history = previous.quizHistory?.[result.moduleId] ?? (priorResult ? [priorResult] : []);
      const remediations = { ...previous.remediations };
      delete remediations[result.moduleId];
      return {
        ...previous,
        plan: reconcileProgress({
          ...previous.plan,
          modules: previous.plan.modules.map((item) =>
            item.id === result.moduleId && item.status === "not-started"
              ? { ...item, status: "in-progress" } : item),
        }, quizResults),
        quizResults,
        latestQuizResults: { ...previous.latestQuizResults, [result.moduleId]: result },
        quizHistory: {
          ...previous.quizHistory,
          [result.moduleId]: [...history.filter((item) => attemptKey(item) !== attemptKey(result)), result],
        },
        remediations,
      };
    });
  }, []);
  const saveRemediation = useCallback((response: ReviewResponse, expectedPlanId?: string, expectedPlanGeneration?: string, expectedResult?: QuizResult) => {
    setState((previous) => {
      if (expectedPlanId && previous.plan?.id !== expectedPlanId) return previous;
      if (expectedPlanGeneration && previous.planGeneration !== expectedPlanGeneration) return previous;
      const moduleId = response.review.moduleId;
      const lesson = previous.lessons[moduleId];
      const result = previous.latestQuizResults
        ? previous.latestQuizResults[moduleId] : previous.quizResults[moduleId];
      if (!lesson || !result || !previous.plan?.modules.some((item) => item.id === moduleId && item.status !== "locked")) return previous;
      if (expectedResult && (expectedResult.moduleId !== result.moduleId || attemptKey(expectedResult) !== attemptKey(result))) return previous;
      try { assertReviewResponse(response, lesson, result); }
      catch { return previous; }
      const saved = previous.remediations?.[moduleId];
      return {
        ...previous,
        remediations: {
          ...previous.remediations,
          [moduleId]: {
            ...response,
            ...(saved?.review.attemptedAt === response.review.attemptedAt && saved.reviewedAt
              ? { reviewedAt: saved.reviewedAt } : {}),
          },
        },
      };
    });
  }, []);
  const markRemediationReviewed = useCallback((moduleId: string, attemptedAt: string) => {
    setState((previous) => {
      const saved = previous.remediations?.[moduleId];
      if (!saved || saved.review.attemptedAt !== attemptedAt || saved.reviewedAt) return previous;
      return {
        ...previous,
        remediations: {
          ...previous.remediations,
          [moduleId]: { ...saved, reviewedAt: new Date().toISOString() },
        },
      };
    });
  }, []);
  const loadDemo = useCallback(
    () => setPlan(DEMO_PROFILE, createMockPlan(DEMO_PROFILE), "mock"),
    [setPlan],
  );

  return (
    <LearningContext.Provider
      value={{
        state,
        ready,
        storageWarning,
        setPlan,
        saveLesson,
        updateLessonTeaching,
        replaceQuiz,
        startModule,
        recordQuizResult,
        saveRemediation,
        markRemediationReviewed,
        loadDemo,
      }}
    >
      {children}
    </LearningContext.Provider>
  );
}

export function useLearning() {
  const context = useContext(LearningContext);
  if (!context)
    throw new Error("useLearning must be used inside LearningProvider");
  return context;
}
