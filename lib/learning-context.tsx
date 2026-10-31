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
  assertModule,
  assertProfile,
  assertQuizResult,
} from "@/lib/validators";
import type {
  LearnerProfile,
  LearningState,
  Lesson,
  Module,
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
};

interface LearningContextValue {
  state: LearningState;
  ready: boolean;
  storageWarning: string | null;
  setPlan: (profile: LearnerProfile, plan: StudyPlan) => void;
  saveLesson: (lesson: Lesson) => void;
  startModule: (moduleId: string) => void;
  recordQuizResult: (result: QuizResult) => void;
  loadDemo: () => void;
}

const LearningContext = createContext<LearningContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const tracks = ["data-science", "web-development", "product-design"];
  assertProfile(profile);
  if (
    typeof plan.id !== "string" ||
    plan.profileId !== profile.id ||
    plan.track !== profile.track ||
    !tracks.includes(String(plan.track)) ||
    typeof plan.title !== "string" ||
    typeof plan.summary !== "string" ||
    typeof plan.generatedAt !== "string" ||
    typeof plan.weeklyStudyHours !== "number" ||
    !Number.isFinite(plan.weeklyStudyHours) ||
    plan.weeklyStudyHours < 1 ||
    plan.weeklyStudyHours > 40 ||
    !Array.isArray(plan.modules) ||
    !plan.modules.length ||
    plan.modules.length > 50
  )
    return null;
  plan.modules.forEach(assertModule);
  const modules = plan.modules as Module[];
  const ids = new Set(modules.map((item) => item.id));
  if (
    ids.size !== modules.length ||
    modules.some((item) => item.prerequisites.some((id) => !ids.has(id)))
  )
    return null;
  const lessons: Record<string, Lesson> = {};
  const quizResults: Record<string, QuizResult> = {};
  // Invalid cache entries can be regenerated without losing the learner's path.
  for (const [id, cached] of Object.entries(value.lessons)) {
    try {
      assertLesson(cached);
      if (ids.has(id) && cached.moduleId === id) lessons[id] = cached;
    } catch {
      /* Ignore an outdated lesson. */
    }
  }
  for (const [id, cached] of Object.entries(value.quizResults)) {
    try {
      assertQuizResult(cached);
      if (ids.has(id) && cached.moduleId === id) quizResults[id] = cached;
    } catch {
      /* Ignore an outdated result. */
    }
  }
  return {
    version: 1,
    profile,
    plan: plan as unknown as StudyPlan,
    lessons,
    quizResults,
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

  const setPlan = useCallback((profile: LearnerProfile, plan: StudyPlan) => {
    setState({ ...EMPTY_STATE, profile, plan });
  }, []);
  const saveLesson = useCallback((lesson: Lesson) => {
    setState((previous) =>
      previous.plan?.modules.some((item) => item.id === lesson.moduleId)
        ? {
            ...previous,
            lessons: { ...previous.lessons, [lesson.moduleId]: lesson },
          }
        : previous,
    );
  }, []);
  const startModule = useCallback((moduleId: string) => {
    setState((previous) => {
      if (!previous.plan) return previous;
      const target = previous.plan.modules.find((m) => m.id === moduleId);
      if (!target || target.status !== "not-started") return previous;
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
    setState((previous) => {
      if (!previous.plan) return previous;
      const target = previous.plan.modules.find(
        (item) => item.id === result.moduleId,
      );
      if (!target || target.status === "locked") return previous;
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
    () => setPlan(DEMO_PROFILE, createMockPlan(DEMO_PROFILE)),
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
