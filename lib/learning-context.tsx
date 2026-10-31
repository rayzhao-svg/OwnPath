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
import { EMPTY_STATE, restoreLearningState, knownMode, orderPlan, reconcileProgress, attemptKey, copyQuestions, sameQuestions, snapshotAttempt } from "@/lib/learning-state";
import type { LearningPathSummary } from "@/lib/learning-library";
import type { AccountUser } from "@/lib/account-types";
import type {
  LearnerProfile,
  LearningState,
  Lesson,
  LessonResponse,
  PlanResponse,
  QuizQuestion,
  QuizResult,
  ReviewResponse,
  StudyPlan,
} from "@/lib/types";

const STORAGE_KEY = "ownpath:learning:v1";

export interface LearningWorkspaceControls {
  accountUser: AccountUser | null;
  paths: LearningPathSummary[];
  activePathId: string | null;
  switchPath: (id: string) => Promise<void>;
  newPath: () => Promise<void>;
  deletePath: (id: string) => Promise<void>;
  guestTrackCount: number;
  importGuestTracks: () => Promise<void>;
  syncStatus: "idle" | "syncing" | "saved" | "error";
  syncError: string | null;
  retrySync: () => Promise<void>;
  logoutAccount: () => Promise<void>;
}
const noop = async () => {};
const DEFAULT_WORKSPACE: LearningWorkspaceControls = {
  accountUser: null,
  paths: [], activePathId: null, switchPath: noop, newPath: noop, deletePath: noop,
  guestTrackCount: 0, importGuestTracks: noop, syncStatus: "idle", syncError: null,
  retrySync: noop, logoutAccount: noop,
};

interface LearningContextValue extends LearningWorkspaceControls {
  state: LearningState;
  ready: boolean;
  storageWarning: string | null;
  setPlan: (profile: LearnerProfile, plan: StudyPlan, mode?: PlanResponse["mode"]) => void | Promise<void>;
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

function restoreState(raw: string): LearningState | null {
  return restoreLearningState(raw);
}

export function LearningProvider({ children, initialState, onStateChange, onPlanCreated, workspace, isReady = true }: {
  children: React.ReactNode;
  initialState?: LearningState;
  onStateChange?: (state: LearningState) => void;
  onPlanCreated?: (state: LearningState) => Promise<void>;
  workspace?: LearningWorkspaceControls;
  isReady?: boolean;
}) {
  const [state, setState] = useState<LearningState>(() => initialState ?? EMPTY_STATE);
  const [ready, setReady] = useState(initialState !== undefined);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  useEffect(() => {
    if (initialState !== undefined) return;
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
  }, [initialState]);

  useEffect(() => {
    if (!ready || !state.plan) return;
    if (onStateChange) { onStateChange(state); return; }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      queueMicrotask(() =>
        setStorageWarning(
          "Your browser could not save progress. Keep this tab open to continue.",
        ),
      );
    }
  }, [state, ready, onStateChange]);

  const setPlan = useCallback((profile: LearnerProfile, plan: StudyPlan, mode?: PlanResponse["mode"]) => {
    assertProfile(profile);
    assertStudyPlan(plan);
    if (plan.profileId !== profile.id || plan.track !== profile.track ||
        plan.weeklyStudyHours !== profile.availableStudyTime)
      throw new Error("The curriculum did not match your profile. Please try again.");
    const next = { ...EMPTY_STATE, profile, plan: orderPlan(plan), planGeneration: crypto.randomUUID(), ...(knownMode(mode) ? { planMode: mode } : {}) };
    if (onPlanCreated) return onPlanCreated(next);
    setState(next);
    setStorageWarning(null);
  }, [onPlanCreated]);
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
        ...DEFAULT_WORKSPACE,
        ...workspace,
        state,
        ready: ready && isReady,
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
