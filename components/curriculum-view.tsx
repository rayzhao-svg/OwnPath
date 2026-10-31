"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useLearning } from "@/lib/learning-context";
import { createMockPlan, DEMO_PROFILE } from "@/lib/mock-data";
import { assertAttemptForLesson, diagnoseMistakes } from "@/lib/remediation";
import type { Module } from "@/lib/types";

const samplePlan = createMockPlan(DEMO_PROFILE);

function Duration({ minutes }: { minutes: number }) {
  return (
    <>
      {minutes >= 60
        ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
        : `${minutes} min`}
    </>
  );
}

export function CurriculumView() {
  const { state, ready, loadDemo } = useLearning();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "remaining" | "completed">(
    "all",
  );
  const [resources, setResources] = useState<string | null>(null);
  if (!ready)
    return (
      <div className="loading-state" role="status">
        Getting your path ready…
      </div>
    );
  const plan = state.plan || samplePlan;
  const demo = !state.plan;
  const completed = plan.modules.filter((m) => m.status === "completed").length;
  const totalMinutes = plan.modules.reduce(
    (total, m) => total + m.estimatedDuration,
    0,
  );
  function currentAttempt(moduleId: string) {
    const result = state.latestQuizResults
      ? state.latestQuizResults[moduleId] : state.quizResults[moduleId];
    const lesson = state.lessons[moduleId];
    if (!result || result.moduleId !== moduleId) return undefined;
    if (lesson) {
      try { assertAttemptForLesson(lesson, result); }
      catch { return undefined; }
    }
    return result;
  }
  const reviewModule = !demo ? plan.modules
    .filter((module) => {
      const latest = currentAttempt(module.id);
      return module.status !== "locked" && module.status !== "completed" && latest && !latest.passed;
    })
    .sort((a, b) => {
      const aResult = currentAttempt(a.id);
      const bResult = currentAttempt(b.id);
      return Date.parse(bResult?.completedAt ?? "") - Date.parse(aResult?.completedAt ?? "");
    })[0] : undefined;
  const nextModule = reviewModule
    ?? plan.modules.find((module) => module.status === "in-progress")
    ?? plan.modules.find((module) => module.status === "not-started");
  const latestReviewResult = reviewModule
    ? currentAttempt(reviewModule.id)
    : undefined;
  const savedReview = reviewModule ? state.remediations?.[reviewModule.id] : undefined;
  const reviewFinished = !!savedReview?.reviewedAt && savedReview.review.attemptedAt === latestReviewResult?.completedAt;
  function weakConcepts(moduleId: string): string[] {
    const result = currentAttempt(moduleId);
    const lesson = state.lessons[moduleId];
    if (!result || !lesson || !result.answers) return [];
    return [...new Set(diagnoseMistakes(lesson, result).map((mistake) => mistake.concept))];
  }
  const progress = Math.round((completed / plan.modules.length) * 100);
  const visible = plan.modules.filter(
    (m) =>
      filter === "all" ||
      (filter === "completed"
        ? m.status === "completed"
        : m.status !== "completed"),
  );
  const weeks = Math.max(
    1,
    Math.ceil(totalMinutes / (plan.weeklyStudyHours * 60)),
  );
  function openModule(module: Module, anchor?: string) {
    if (demo) loadDemo();
    router.push(`/learn/${module.id}${anchor ? `#${anchor}` : ""}`);
  }

  return (
    <div className="dashboard-view">
      <div className="dashboard-greeting">
        <div>
          <span className="eyebrow">
            {demo
              ? "A GLIMPSE OF WHAT’S POSSIBLE"
              : "A LITTLE PROGRESS GOES A LONG WAY"}
          </span>
          <h1>
            {demo
              ? "Meet your next chapter."
              : `Good to see you, ${state.profile?.name || "learner"}.`}
          </h1>
          <p>
            {demo
              ? "Explore a sample path, then make one that’s yours."
              : "Your goals haven’t moved. Let’s take another step toward them."}
          </p>
        </div>
        <Link href="/onboarding" className="button button-secondary">
          <Icon name={demo ? "plus" : "target"} size={16} />
          {demo ? "Create my own path" : "Edit my profile"}
        </Link>
      </div>
      <section className="path-banner">
        <div className="path-banner-main">
          <div className="path-banner-eyebrow">
            <span className="eyebrow">
              {demo ? "SAMPLE LEARNING PATH" : "YOUR PERSONAL LEARNING PATH"}
            </span>
            <span className="path-level">
              {demo || state.planMode === "mock"
                ? "Mock curriculum"
                : state.planMode === "claude"
                  ? "Claude curriculum"
                  : "Saved curriculum"}
            </span>
          </div>
          <h2>{plan.title}</h2>
          <p>{plan.summary}</p>
          <div className="path-banner-stats">
            <span>
              <Icon name="layers" size={16} /> {plan.modules.length} focused
              modules
            </span>
            <span>
              <Icon name="clock" size={16} /> {plan.weeklyStudyHours} hours /
              week
            </span>
            <span>
              <Icon name="target" size={16} /> About {weeks}{" "}
              {weeks === 1 ? "week" : "weeks"}
            </span>
          </div>
        </div>
        <div className="progress-display">
          <div
            className="progress-ring"
            style={{
              background: `conic-gradient(#d8e9af ${progress}%, #526449 ${progress}%)`,
            }}
          >
            <div>
              <strong>
                {progress}
                <span>%</span>
              </strong>
              <small>of your path</small>
            </div>
          </div>
          <span>
            {completed} of {plan.modules.length} modules complete
          </span>
        </div>
      </section>
      <div className="dashboard-columns">
        <div className="curriculum-main">
          <div className="curriculum-heading">
            <div>
              <h2>Your curriculum</h2>
              <p>One step builds on the next. You’ve got this.</p>
            </div>
            <span className="curriculum-count">
              {plan.modules.length} MODULES
            </span>
          </div>
          <div
            className="curriculum-tabs"
            role="group"
            aria-label="Filter modules"
          >
            {(["all", "remaining", "completed"] as const).map((value) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "All modules"
                  : value === "remaining"
                    ? "To learn"
                    : "Completed"}
                {value === "all" && <span>{plan.modules.length}</span>}
              </button>
            ))}
          </div>
          <div className="module-list">
            {visible.length === 0 && (
              <div className="empty-filter">
                <Icon
                  name={filter === "completed" ? "leaf" : "check"}
                  size={26}
                />
                <h3>
                  {filter === "completed"
                    ? "Your first milestone is ahead."
                    : "Look how far you’ve come."}
                </h3>
                <p>
                  {filter === "completed"
                    ? "Complete a lesson and pass its quiz to see it here."
                    : "You’ve completed every module in this path."}
                </p>
              </div>
            )}
            {visible.map((module) => {
              const index = plan.modules.findIndex((m) => m.id === module.id);
              const locked = module.status === "locked";
              const done = module.status === "completed";
              const current = module.id === nextModule?.id;
              const latest = currentAttempt(module.id);
              const best = state.quizResults[module.id];
              const currentResult = currentAttempt(module.id);
              const needsReview = !locked && !done && currentResult && !currentResult.passed;
              const concepts = needsReview ? weakConcepts(module.id) : [];
              return (
                <article
                  key={module.id}
                  className={`module-card ${current ? "module-current" : ""} ${locked ? "module-locked" : ""}`}
                >
                  <div className={`module-number ${done ? "done" : ""}`}>
                    {done ? (
                      <Icon name="check" size={20} />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </div>
                  <div className="module-content">
                    <div className="module-topline">
                      <span>MODULE {String(index + 1).padStart(2, "0")}</span>
                      {current && (
                        <span className="module-status">
                          {needsReview
                            ? "Review recommended"
                            : module.status === "in-progress"
                            ? "In progress"
                            : "Your next step"}
                        </span>
                      )}
                      {done && (
                        <span className="module-status done">Completed</span>
                      )}
                      {locked && (
                        <span className="locked-label">
                          <Icon name="lock" size={11} /> Up next
                        </span>
                      )}
                    </div>
                    <h3>{module.title}</h3>
                    <p>{module.description}</p>
                    {best && (
                      <p className="muted">
                        Best assessment: {best.score}%
                        {latest && latest.completedAt !== best.completedAt
                          ? ` · Latest attempt: ${latest.score}%`
                          : ""}
                        {done ? " · Completion saved" : " · 70% to complete"}
                      </p>
                    )}
                    {needsReview && (
                      <p className="muted">
                        {concepts.length
                          ? `Focus on: ${concepts.slice(0, 3).join(", ")}.`
                          : "Review the lesson and retry the assessment to identify your weak areas."}
                      </p>
                    )}
                    <div className="module-topics">
                      {module.topics.slice(0, 3).map((topic) => (
                        <span key={topic}>{topic}</span>
                      ))}
                    </div>
                    <div className="module-bottomline">
                      <div>
                        <span>
                          <Icon name="clock" size={13} />
                          <Duration minutes={module.estimatedDuration} />
                        </span>
                        <button
                          className="resource-toggle"
                          aria-expanded={resources === module.id}
                          aria-controls={`resources-${module.id}`}
                          onClick={() =>
                            setResources(
                              resources === module.id ? null : module.id,
                            )
                          }
                        >
                          <Icon name="book" size={13} />
                          {module.resources.length} resources
                        </button>
                      </div>
                      {locked ? (
                        <span className="prerequisite-note">
                          Complete: {module.prerequisites
                            .filter((id) => plan.modules.find((item) => item.id === id)?.status !== "completed")
                            .map((id) => plan.modules.find((item) => item.id === id)?.title)
                            .join(", ") || "the prerequisite modules"}
                        </span>
                      ) : (
                        <button
                          className={`button ${current ? "button-primary" : "button-secondary"} button-small`}
                          onClick={() => openModule(module, needsReview && currentResult.answers ? "targeted-review" : undefined)}
                        >
                          {done
                            ? "Review lesson"
                            : needsReview && currentResult.answers
                              ? "Review weak areas"
                            : module.status === "in-progress"
                              ? "Continue learning"
                              : "Start learning"}
                          <Icon name="arrow-right" size={14} />
                        </button>
                      )}
                    </div>
                    {resources === module.id && (
                      <div
                        className="module-resources"
                        id={`resources-${module.id}`}
                      >
                        <strong>Go a little deeper</strong>
                        {module.resources.map((resource) => (
                          <a
                            href={resource.url}
                            key={resource.id}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span>
                              <b>{resource.title}</b>
                              <small>
                                {resource.provider} · {resource.type}
                              </small>
                            </span>
                            <Icon name="external" size={14} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <aside className="dashboard-aside">
          <div className="next-step-card">
            <span className="feature-icon">
              <Icon name={reviewModule ? "book" : nextModule ? "play" : "check"} size={22} />
            </span>
            <span className="eyebrow">
              {reviewModule
                ? reviewFinished ? "READY FOR ANOTHER TRY" : "A REVIEW THAT FITS YOU"
                : nextModule
                ? "YOUR NEXT SMALL STEP"
                : "A MILESTONE WORTH CELEBRATING"}
            </span>
            <h3>{nextModule?.title || "You made it to the end."}</h3>
            <p>
              {reviewModule
                ? reviewFinished
                  ? "You’ve worked through your review. Try the knowledge check again; 70% completes this module."
                  : `Your latest score was ${latestReviewResult?.score}%. ${weakConcepts(reviewModule.id).length ? `Focus on ${weakConcepts(reviewModule.id).slice(0, 3).join(", ")}.` : "Revisit the lesson concepts before your next attempt."}`
                : nextModule
                ? "A focused lesson, a little curiosity, and you’re on your way."
                : "Revisit a lesson or create a path for your next goal."}
            </p>
            {nextModule ? (
              <button
                className="button button-primary"
                onClick={() => openModule(nextModule, reviewModule
                  ? reviewFinished || !latestReviewResult?.answers ? "knowledge-check" : "targeted-review"
                  : undefined)}
              >
                {reviewModule
                  ? reviewFinished || !latestReviewResult?.answers ? "Retry knowledge check" : "Review weak areas"
                  : completed || nextModule.status === "in-progress"
                  ? "Keep going"
                  : "Let’s begin"}
                <Icon name="arrow-right" size={16} />
              </button>
            ) : (
              <Link href="/onboarding" className="button button-primary">
                Find my next path
                <Icon name="arrow-right" size={16} />
              </Link>
            )}
            <span className="next-step-time">
              <Icon name="clock" size={12} />
              {reviewModule ? (
                "A short review, then a fresh assessment"
              ) : nextModule ? (
                <>
                  <Duration minutes={nextModule.estimatedDuration} /> at your
                  own pace
                </>
              ) : (
                "One chapter opens another"
              )}
            </span>
          </div>
          <div className="how-to-learn">
            <span className="eyebrow">A NOTE FOR YOUR JOURNEY</span>
            <h3>Consistency over intensity.</h3>
            <p>
              A small window of focused learning beats waiting for the perfect
              time. Start where you are.
            </p>
            <span className="handwritten">Little by little, a lot.</span>
            <Icon name="leaf" size={27} />
          </div>
          <div className="demo-disclosure">
            <Icon name="sparkles" size={16} />
            <p>
              Follow your lessons, ask questions, and check your understanding.
              Your path and progress stay in this browser.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
