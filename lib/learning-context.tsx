"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createMockPlan, DEMO_PROFILE } from "@/lib/mock-data";
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
  QuizResult,
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
};

interface LearningContextValue {
  state: LearningState;
  ready: boolean;
  storageWarning: string | null;
  setPlan: (profile: LearnerProfile, plan: StudyPlan, mode?: PlanResponse["mode"]) => void;
  saveLesson: (lesson: Lesson, mode?: LessonResponse["mode"], expectedPlanId?: string, expectedPlanGeneration?: string) => void;
  startModule: (moduleId: string, expectedPlanId?: string, expectedPlanGeneration?: string) => void;
  recordQuizResult: (result: QuizResult) => void;
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

function restoreState(raw: string): LearningState | null {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.profile) ||
    !isRecord(value.plan) ||
    !isRecord(value.lessons) ||
    !isRecord(value.quizResults)
  )
    return null;
  const profile = value.profile;
  const plan = value.plan;
  assertProfile(profile);
  assertStudyPlan(plan);
  if (
    plan.profileId !== profile.id ||
    plan.track !== profile.track ||
    plan.weeklyStudyHours !== profile.availableStudyTime
  )
    return null;
  const byId = new Map(plan.modules.map((item) => [item.id, item]));
  const lessons: Record<string, Lesson> = {};
  const quizResults: Record<string, QuizResult> = {};
  const lessonModes: NonNullable<LearningState["lessonModes"]> = {};
  // Invalid cache entries can be regenerated without losing the learner's path.
  for (const [id, cached] of Object.entries(value.lessons)) {
    try {
      assertLesson(cached);
      const learningModule = byId.get(id);
      if (learningModule && cached.moduleId === id && cached.title === learningModule.title)
        lessons[id] = cached;
    } catch {
      /* Ignore an outdated lesson. */
    }
  }
  for (const [id, cached] of Object.entries(value.quizResults)) {
    try {
      assertQuizResult(cached);
      if (
        byId.has(id) && cached.moduleId === id &&
        (!lessons[id] || (lessons[id].id === cached.lessonId && lessons[id].quiz.length === cached.totalQuestions))
      ) quizResults[id] = cached;
    } catch {
      /* Ignore an outdated result. */
    }
  }
  if (isRecord(value.lessonModes)) {
    for (const [id, mode] of Object.entries(value.lessonModes)) {
      if (lessons[id] && knownMode(mode)) lessonModes[id] = mode;
    }
  }
  return {
    version: 1,
    profile,
    plan: orderPlan(plan),
    lessons,
    quizResults,
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
      const quizResults = { ...previous.quizResults };
      const priorResult = quizResults[lesson.moduleId];
      if (priorResult && (priorResult.lessonId !== lesson.id || priorResult.totalQuestions !== lesson.quiz.length))
        delete quizResults[lesson.moduleId];
      return {
        ...previous,
        lessons: { ...previous.lessons, [lesson.moduleId]: lesson },
        lessonModes,
        quizResults,
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
  const recordQuizResult = useCallback((result: QuizResult) => {
    assertQuizResult(result);
    setState((previous) => {
      if (!previous.plan) return previous;
      const target = previous.plan.modules.find(
        (item) => item.id === result.moduleId,
      );
      if (!target || target.status === "locked") return previous;
      const currentLesson = previous.lessons[result.moduleId];
      if (currentLesson?.id !== result.lessonId || currentLesson.quiz.length !== result.totalQuestions) return previous;
      if (!target.prerequisites.every((id) => previous.plan!.modules.some((item) => item.id === id && item.status === "completed"))) return previous;
      const priorResult = previous.quizResults[result.moduleId];
      const bestResult =
        priorResult && priorResult.score > result.score ? priorResult : result;
      const modules = previous.plan.modules.map((m) =>
        m.id === result.moduleId && result.passed
          ? { ...m, status: "completed" as const }
          : m,
      );
      const completed = new Set(
        modules.filter((m) => m.status === "completed").map((m) => m.id),
      );
      const unlocked = modules.map((m) =>
        m.status === "locked" &&
        m.prerequisites.every((id) => completed.has(id))
          ? { ...m, status: "not-started" as const }
          : m,
      );
      return {
        ...previous,
        plan: { ...previous.plan, modules: unlocked },
        quizResults: { ...previous.quizResults, [result.moduleId]: bestResult },
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
        startModule,
        recordQuizResult,
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
