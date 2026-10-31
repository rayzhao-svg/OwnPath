"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { LectureChat } from "@/components/lecture-chat";
import { LecturePlayer } from "@/components/lecture-player";
import { Quiz } from "@/components/quiz";
import { requestChapterDetailResponse, requestLessonResponse, requestQuizRefreshResponse, requestReviewResponse } from "@/lib/api-client";
import { useLearning } from "@/lib/learning-context";
import { DEFAULT_QUIZ_QUESTION_COUNT, isQuizQuestionCount } from "@/lib/quiz-refresh";
import { resourcesForLesson } from "@/lib/lesson-resources";
import { assertLessonRequestBudget } from "@/lib/lesson-budget";
import { assertAttemptForLesson, createMockReview, diagnoseMistakes, lessonForAttempt } from "@/lib/remediation";
import type { Lesson, LessonResponse, QuizResult, ReviewResponse } from "@/lib/types";
import "@/app/learn/lesson.css";

async function requestReview(lesson: Lesson, result: QuizResult): Promise<ReviewResponse> {
  try {
    return await requestReviewResponse(lesson, result);
  } catch {
    // A connection failure must not prevent focused practice or erase progress.
    return { ...createMockReview({ lesson, result }), fallbackReason: "generation-failed" };
  }
}

export function LessonExperience({ moduleId }: { moduleId: string }) {
  const { state, ready, saveLesson, updateLessonTeaching, startModule, recordQuizResult, replaceQuiz, saveRemediation, markRemediationReviewed } =
    useLearning();
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [detailStatus, setDetailStatus] = useState({ key: "", busy: false, error: "" });
  const detailRequest = useRef<{ controller: AbortController; key: string } | null>(null);
  const attemptedDetails = useRef(new Set<string>());
  const [slidePosition, setSlidePosition] = useState({ key: "", index: 0 });
  const [tutorBusy, setTutorBusy] = useState(false);
  const [quizRetry, setQuizRetry] = useState(0);
  const [quizSettings, setQuizSettings] = useState({ key: "", count: DEFAULT_QUIZ_QUESTION_COUNT });
  const [quizRefresh, setQuizRefresh] = useState({ key: "", busy: false, error: "" });
  const quizRequest = useRef<{ controller: AbortController; key: string } | null>(null);
  const seenQuestions = useRef(new Map<string, string[]>());
  const [loadingReview, setLoadingReview] = useState<string | null>(null);
  const reviewRequests = useRef(new Map<string, Promise<ReviewResponse>>());
  const reviewQuestionRef = useRef<((question: string) => void) | null>(null);
  const pauseNarrationRef = useRef<(() => void) | null>(null);
  const pauseNarration = useCallback(() => pauseNarrationRef.current?.(), []);
  const requests = useRef(new Map<string, Promise<LessonResponse>>());
  const currentModule = state.plan?.modules.find(
    (item) => item.id === moduleId,
  );
  const lesson = state.lessons[moduleId];
  const latestLesson = useRef(lesson);
  useEffect(() => { latestLesson.current = lesson; }, [lesson]);
  const lessonMode = state.lessonModes?.[moduleId];
  const requestKey = `${state.planGeneration}:${state.plan?.id}:${moduleId}`;
  const lessonKey = `${requestKey}:${lesson?.id}`;
  const questionCount = quizSettings.key === lessonKey ? quizSettings.count
    : lesson && isQuizQuestionCount(lesson.quiz.length) ? lesson.quiz.length : DEFAULT_QUIZ_QUESTION_COUNT;
  const slideIndex = slidePosition.key === lessonKey ? slidePosition.index : 0;
  const activeChapter = lesson?.slides[slideIndex];
  const chapterKey = `${lessonKey}:${activeChapter?.id}`;
  const visibleChapter = useRef(activeChapter?.id);
  useEffect(() => { visibleChapter.current = activeChapter?.id; }, [activeChapter?.id]);
  const error = loadError?.key === requestKey ? loadError.message : "";
  const detailBusy = detailStatus.key === chapterKey && detailStatus.busy;
  const detailError = detailStatus.key === chapterKey ? detailStatus.error : "";
  const needsDetail = !!activeChapter && lessonMode !== "mock" && (activeChapter.teachingVersion !== 2 || activeChapter.qualityVersion !== 1);
  const latestCandidate = state.latestQuizResults
    ? state.latestQuizResults[moduleId] : state.quizResults[moduleId];
  let latestResult: QuizResult | undefined;
  if (lesson && latestCandidate) {
    try {
      assertAttemptForLesson(lesson, latestCandidate);
      latestResult = latestCandidate;
    } catch { /* Historical scores do not diagnose a replacement lesson. */ }
  }
  const storedReview = state.remediations?.[moduleId];
  const savedReview = storedReview?.review.lessonId === lesson?.id &&
    storedReview?.review.attemptedAt === latestResult?.completedAt ? storedReview : undefined;
  const reviewKey = `${lessonKey}:${latestResult?.completedAt}:${JSON.stringify(latestResult?.answers)}`;
  const reviewBusy = loadingReview === reviewKey;
  const quizBusy = quizRefresh.key === lessonKey && quizRefresh.busy;
  const quizError = quizRefresh.key === lessonKey ? quizRefresh.error : "";
  const diagnosticLesson = lesson && latestResult ? lessonForAttempt(lesson, latestResult) : lesson;
  const needsFreshQuiz = !!lesson && !!latestResult && diagnosticLesson?.quiz.every(
    (question, index) => question.id === lesson.quiz[index]?.id,
  );
  const moduleIndex =
    state.plan?.modules.findIndex((item) => item.id === moduleId) ?? -1;

  useEffect(() => () => {
    quizRequest.current?.controller.abort();
    quizRequest.current = null;
    if (detailRequest.current) attemptedDetails.current.delete(detailRequest.current.key);
    detailRequest.current?.controller.abort();
    detailRequest.current = null;
  }, [lessonKey]);

  const expandLesson = useCallback(async (slideId = activeChapter?.id) => {
    if (!lesson || !slideId || !currentModule || currentModule.status === "locked" || quizRequest.current) return;
    const key = `${lessonKey}:${slideId}`;
    if (detailRequest.current) {
      if (detailRequest.current.key === key) return;
      attemptedDetails.current.delete(detailRequest.current.key);
      detailRequest.current.controller.abort();
    }
    const ticket = { controller: new AbortController(), key };
    detailRequest.current = ticket;
    attemptedDetails.current.add(key);
    setDetailStatus({ key, busy: true, error: "" });
    try {
      const response = await requestChapterDetailResponse(lesson, currentModule, slideId, ticket.controller.signal);
      if (ticket.controller.signal.aborted || detailRequest.current !== ticket) return;
      const current = latestLesson.current;
      if (!current || current.id !== lesson.id) return;
      const updated = { ...current, slides: current.slides.map((slide) => slide.id === slideId ? response.slide : slide) };
      assertLessonRequestBudget(updated);
      if (visibleChapter.current === slideId) pauseNarration();
      updateLessonTeaching(updated, response.mode, state.plan?.id, state.planGeneration);
      setDetailStatus({ key, busy: false, error: "" });
    } catch (cause) {
      if (ticket.controller.signal.aborted || detailRequest.current !== ticket) return;
      setDetailStatus({ key, busy: false, error: cause instanceof Error
        ? cause.message : "The full chapter could not load. Your saved lesson is still available." });
    } finally {
      if (detailRequest.current === ticket) detailRequest.current = null;
    }
  }, [lesson, currentModule, activeChapter?.id, lessonKey, pauseNarration, updateLessonTeaching, state.plan, state.planGeneration]);

  useEffect(() => {
    if (!ready || !lesson || !activeChapter || lessonMode === "mock" || !currentModule || currentModule.status === "locked" || quizBusy) return;
    // Prepare the current chapter first, then just one chapter ahead. Longer
    // courses never require one giant generation or an upload of cached text.
    const next = lesson.slides[slideIndex + 1];
    const target = needsDetail ? activeChapter : next && (next.teachingVersion !== 2 || next.qualityVersion !== 1) ? next : undefined;
    if (!target || attemptedDetails.current.has(`${lessonKey}:${target.id}`)) return;
    let active = true;
    // Strict Mode's first effect is cleaned up before starting a provider call.
    queueMicrotask(() => { if (active) void expandLesson(target.id); });
    return () => { active = false; };
  }, [ready, lesson, lessonMode, activeChapter, slideIndex, needsDetail, currentModule, lessonKey, expandLesson, quizBusy]);

  const refreshQuestions = useCallback(async (reviewAttempt?: string) => {
    if (!lesson || quizRequest.current) return;
    if (detailRequest.current) {
      // A requested quiz takes priority over the optional background expansion.
      // Resume expansion from the latest saved quiz once this request settles.
      const interrupted = detailRequest.current;
      detailRequest.current = null;
      attemptedDetails.current.delete(interrupted.key);
      interrupted.controller.abort();
      setDetailStatus({ key: lessonKey, busy: false, error: "" });
    }
    const ticket = { controller: new AbortController(), key: lessonKey };
    quizRequest.current = ticket;
    pauseNarration();
    setQuizRefresh({ key: lessonKey, busy: true, error: "" });
    const history = state.quizHistory?.[moduleId] ?? [];
    const previousQuestions = [...new Set([
      ...history.flatMap((result) => result.questions?.map((question) => question.question) ?? []),
      ...(seenQuestions.current.get(lessonKey) ?? []),
      ...(latestResult?.questions?.map((question) => question.question) ?? []),
      ...lesson.quiz.map((question) => question.question),
    ])].slice(-60);
    try {
      const response = await requestQuizRefreshResponse(lesson, previousQuestions, questionCount, ticket.controller.signal);
      if (ticket.controller.signal.aborted || quizRequest.current !== ticket) return;
      const current = latestLesson.current;
      if (!current || current.id !== lesson.id) return;
      assertLessonRequestBudget({ ...current, quiz: response.quiz });
      replaceQuiz(lesson.id, moduleId, response.quiz, state.plan?.id, state.planGeneration);
      seenQuestions.current.set(lessonKey, [...previousQuestions, ...response.quiz.map((question) => question.question)].slice(-60));
      if (reviewAttempt) markRemediationReviewed(moduleId, reviewAttempt);
      setQuizRetry((value) => value + 1);
      setQuizRefresh({ key: lessonKey, busy: false, error: "" });
      requestAnimationFrame(() => document.getElementById("knowledge-check")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (cause) {
      if (ticket.controller.signal.aborted || quizRequest.current !== ticket) return;
      setQuizRefresh({ key: lessonKey, busy: false, error: cause instanceof Error ? cause.message : "New questions could not be created. Please try again." });
      requestAnimationFrame(() => document.getElementById("knowledge-check")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } finally {
      if (quizRequest.current === ticket) quizRequest.current = null;
    }
  }, [lesson, lessonKey, questionCount, moduleId, state.quizHistory, state.plan, state.planGeneration, latestResult, replaceQuiz, markRemediationReviewed, pauseNarration]);

  useEffect(() => {
    if (!ready || !currentModule || currentModule.status === "locked" || lesson)
      return;
    let active = true;
    const planId = state.plan?.id;
    const planGeneration = state.planGeneration;
    let request = requests.current.get(requestKey);
    if (!request) {
      request = requestLessonResponse(currentModule);
      requests.current.set(requestKey, request);
    }
    void request
      .then((response) => {
        if (!active) return;
        setLoadError(null);
        saveLesson(response.lesson, response.mode, planId, planGeneration);
        startModule(currentModule.id, planId, planGeneration);
      })
      .catch((cause: unknown) => {
        requests.current.delete(requestKey);
        if (active)
          setLoadError({ key: requestKey, message: cause instanceof Error
              ? cause.message
              : "This lesson could not load. Please try again." });
      });
    return () => {
      active = false;
    };
  }, [ready, currentModule, lesson, saveLesson, startModule, attempt, state.plan?.id, state.planGeneration, requestKey]);

  const prepareReview = useCallback((result: QuizResult) => {
    if (!lesson || result.lessonId !== lesson.id || !diagnoseMistakes(lesson, result).length) return;
    const key = `${lessonKey}:${result.completedAt}:${JSON.stringify(result.answers)}`;
    const planId = state.plan?.id;
    const planGeneration = state.planGeneration;
    let request = reviewRequests.current.get(key);
    if (!request) {
      request = requestReview(lesson, result);
      reviewRequests.current.set(key, request);
    }
    setLoadingReview(key);
    void request.then((response) => {
      saveRemediation(response, planId, planGeneration, result);
    }).finally(() => {
      setLoadingReview((current) => current === key ? null : current);
    });
  }, [lesson, lessonKey, state.plan?.id, state.planGeneration, saveRemediation]);

  useEffect(() => {
    if (!ready || !lesson || !latestResult || latestResult.passed || savedReview ||
        currentModule?.status === "locked" || !latestResult.answers) return;
    // Resume an interrupted review after refresh, using the actual missed answers.
    let active = true;
    queueMicrotask(() => { if (active) prepareReview(latestResult); });
    return () => { active = false; };
  }, [ready, lesson, latestResult, savedReview, currentModule?.status, prepareReview]);

  const unavailable =
    ready &&
    (!state.plan || !currentModule || currentModule.status === "locked");

  return (
    <AppShell active="learn">
      {!ready ? (
        <div className="lesson-empty" role="status">
          <span className="eyebrow">GETTING THINGS READY</span>
          <h1>Finding your place…</h1>
        </div>
      ) : unavailable ? (
        <div className="lesson-empty card">
          <span className="lesson-empty-icon">
            <Icon
              name={currentModule?.status === "locked" ? "lock" : "book"}
              size={30}
            />
          </span>
          <span className="eyebrow">ONE STEP AT A TIME</span>
          <h1>
            {currentModule?.status === "locked"
              ? "This chapter is up next."
              : state.plan
                ? "Let’s get you back on your path."
                : "Your journey starts with you."}
          </h1>
          <p>
            {currentModule?.status === "locked"
              ? "Complete the prerequisite modules to unlock this lesson. Every small step builds on the last."
              : state.plan
                ? "This lesson isn’t part of your current curriculum. Your dashboard has your latest next steps."
                : "Tell us a little about your background and goals to create a curriculum that fits."}
          </p>
          <Link
            href={state.plan ? "/dashboard" : "/onboarding"}
            className="button button-primary"
          >
            {state.plan ? "Back to my path" : "Create my path"}
            <Icon name="arrow-right" size={17} />
          </Link>
        </div>
      ) : (
        currentModule && (
          <div className="lesson-page">
            <nav className="lesson-breadcrumb" aria-label="Breadcrumb">
              <Link href="/dashboard">
                <Icon name="arrow-left" size={15} /> My learning path
              </Link>
              <Icon name="chevron-right" size={13} />
              <span>Module {String(moduleIndex + 1).padStart(2, "0")}</span>
            </nav>
            <header className="lesson-heading">
              <div>
                <span className="eyebrow">YOUR NEXT SMALL STEP</span>
                <h1>{currentModule.title}</h1>
                <p>{currentModule.description}</p>
              </div>
              <a className="button button-secondary" href="#knowledge-check">
                Knowledge check <Icon name="arrow-right" size={16} />
              </a>
            </header>
            <div className="lesson-meta">
              <span>
                <Icon name="clock" size={15} />{" "}
                {currentModule.estimatedDuration} min module
              </span>
              <span>
                <Icon name="headphones" size={15} /> Listen or read
              </span>
              <span>
                <Icon name="sparkles" size={15} />{" "}
                {lessonMode === "claude"
                  ? "AI-generated lesson"
                  : lessonMode === "mock"
                    ? "Mock lesson preview"
                    : lesson ? "Saved lesson" : "Preparing lesson"}
              </span>
              {currentModule.status === "completed" && (
                <span className="lesson-completed">
                  <Icon name="check" size={15} /> Completed
                </span>
              )}
            </div>
            {error ? (
              <div className="lesson-load-error card" role="alert">
                <h2>A small pause in the path.</h2>
                <p>{error}</p>
                <button
                  className="button button-primary"
                  onClick={() => {
                    setLoadError(null);
                    setAttempt((value) => value + 1);
                  }}
                >
                  Try again <Icon name="refresh" size={16} />
                </button>
              </div>
            ) : !lesson ? (
              <div className="lesson-loading card" role="status">
                <span className="lesson-loading-mark">
                  <Icon name="sparkles" size={28} />
                </span>
                <h2>Opening your next chapter…</h2>
                <p className="muted">
                  Preparing your lecture, questions, and a little clarity.
                </p>
              </div>
            ) : (
              <>
                <nav className="course-chapters card" aria-label="Course chapters">
                  <div className="course-chapters-heading"><span className="eyebrow">YOUR COURSE</span><span>{lesson.slides.length} chapters</span></div>
                  <ol>{lesson.slides.map((chapter, index) => <li key={chapter.id}>
                    <button type="button" aria-current={index === slideIndex ? "step" : undefined} onClick={() => {
                      pauseNarration();
                      setSlidePosition({ key: lessonKey, index });
                    }}><span>{String(index + 1).padStart(2, "0")}</span><span>{chapter.title}</span></button>
                  </li>)}</ol>
                </nav>
                {detailBusy && <p className="lecture-notice" role="status">Preparing this chapter’s explanations, worked examples, and practice…</p>}
                {detailError && (
                  <div className="tutor-error" role="alert">
                    <p>{detailError}</p>
                    <button type="button" disabled={quizBusy || detailBusy} onClick={() => { void expandLesson(); }}>Retry expanded explanation</button>
                  </div>
                )}
                {needsDetail && !detailBusy && !detailError && <p className="lecture-notice">This is the chapter overview. <button type="button" className="narration-reconnect" disabled={quizBusy} onClick={() => { void expandLesson(); }}>Load full chapter</button></p>}
                <div className="lesson-main-grid">
                  <LecturePlayer
                    key={`player-${lessonKey}`}
                    lesson={lesson}
                    slideIndex={slideIndex}
                    chapterLoading={detailBusy}
                    requireDetailedChapter={lessonMode === "claude"}
                    onSlideChange={(index) => setSlidePosition({ key: lessonKey, index })}
                    pauseNarrationRef={pauseNarrationRef}
                  />
                  <LectureChat
                    key={`chat-${lessonKey}`}
                    lesson={lesson}
                    slideIndex={slideIndex}
                    onInteract={pauseNarration}
                    reviewQuestionRef={reviewQuestionRef}
                    onBusyChange={setTutorBusy}
                  />
                </div>
                {(reviewBusy || savedReview || (latestResult && !latestResult.passed)) && (
                  <section className="lesson-quiz card" id="targeted-review" aria-labelledby="targeted-review-title" tabIndex={-1}>
                    <div className="quiz-heading">
                      <div>
                        <span className="eyebrow">A FOCUSED SECOND LOOK</span>
                        <h2 id="targeted-review-title">Review weak areas</h2>
                        <p className="muted">Practice the ideas behind your missed answers, then check your understanding again. Passing still requires 70%.</p>
                      </div>
                      <span className="quiz-heading-icon"><Icon name="book" size={25} /></span>
                    </div>
                    {reviewBusy ? (
                      <p role="status">Preparing explanations and examples for your missed questions…</p>
                    ) : savedReview ? (
                      <>
                        <p className="muted">
                          {savedReview.mode === "claude" ? "Claude targeted review" : "Lesson-based practice review"}
                          {savedReview.fallbackReason && " · AI review was unavailable; this review uses your saved lesson."}
                        </p>
                        <p>{savedReview.review.summary}</p>
                        <div className="quiz-review">
                          <ul>
                            {savedReview.review.areas.map((area) => {
                              const question = diagnosticLesson?.quiz.find((item) => item.id === area.questionId);
                              return (
                                <li key={area.questionId}>
                                  <h3>{area.concept}</h3>
                                  <p><strong>Knowledge gap:</strong> {question?.question}</p>
                                  <p>{area.explanation}</p>
                                  <p><strong>Worked example:</strong> {area.workedExample}</p>
                                  <strong>Try this next</strong>
                                  {area.steps.map((step, index) => <p key={index}>{index + 1}. {step}</p>)}
                                  <button type="button" onClick={() => {
                                    pauseNarration();
                                    setSlidePosition({ key: lessonKey, index: Math.max(0, lesson.slides.findIndex((slide) => slide.id === area.slideId)) });
                                    document.querySelector(".lesson-main-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }}>Revisit the related slide <Icon name="arrow-right" size={14} /></button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        <div className="quiz-result-actions">
                          <button className="button button-primary" type="button" disabled={quizBusy} aria-busy={quizBusy} onClick={() => {
                            if (needsFreshQuiz) void refreshQuestions(savedReview.review.attemptedAt);
                            else document.getElementById("knowledge-check")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}>
                            {quizBusy ? "Writing new questions…" : needsFreshQuiz ? "I’ve reviewed — try new questions" : "Return to the knowledge check"}
                            <Icon name="arrow-right" size={16} />
                          </button>
                        </div>
                        <p className="muted">Reviewing supports practice. Assessment results determine module completion.</p>
                      </>
                    ) : (
                      <p>Your earlier result did not save individual answers. Retry the knowledge check to identify the concepts to review.</p>
                    )}
                  </section>
                )}
                <div className="lesson-lower-grid">
                  <Quiz
                    key={`${lessonKey}:${quizRetry}`}
                    lesson={lesson}
                    previousResult={state.quizResults[moduleId]}
                    latestResult={latestResult}
                    onComplete={(result) => recordQuizResult(result, state.plan?.id, state.planGeneration)}
                    onRetry={() => { void refreshQuestions(); }}
                    questionCount={questionCount}
                    onQuestionCountChange={(count) => {
                      if (isQuizQuestionCount(count)) setQuizSettings({ key: lessonKey, count });
                    }}
                    retryBusy={quizBusy}
                    retryError={quizError}
                    reviewBusy={reviewBusy}
                    onReviewWeakAreas={(result) => {
                      pauseNarration();
                      if (!savedReview || savedReview.review.attemptedAt !== result.completedAt) prepareReview(result);
                      requestAnimationFrame(() => {
                        const panel = document.getElementById("targeted-review");
                        panel?.scrollIntoView({ behavior: "smooth", block: "start" });
                        panel?.focus({ preventScroll: true });
                      });
                    }}
                    reviewDisabled={tutorBusy}
                    onReview={(question) => {
                      pauseNarration();
                      reviewQuestionRef.current?.(question);
                    }}
                  />
                  <aside className="lesson-resources">
                    <span className="eyebrow">GO A LITTLE DEEPER</span>
                    <h2>A few good resources.</h2>
                    <p className="muted">
                      A starting point for a curious mind.
                    </p>
                    {resourcesForLesson(lesson, currentModule, state.plan?.track).map((resource) => (
                      <a
                        key={resource.id}
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lesson-resource"
                      >
                        <span className="lesson-resource-icon">
                          <Icon name="book" size={19} />
                        </span>
                        <div>
                          <span>
                            {resource.provider} · {resource.type}
                          </span>
                          <h3>{resource.title}</h3>
                        </div>
                        <Icon name="external" size={15} />
                      </a>
                    ))}
                    <div className="lesson-resource-note">
                      <Icon name="sparkles" size={19} />
                      <p>
                        Understanding grows with practice. Take the time you
                        need.
                      </p>
                    </div>
                  </aside>
                </div>
              </>
            )}
          </div>
        )
      )}
    </AppShell>
  );
}
