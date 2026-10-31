"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { LectureChat } from "@/components/lecture-chat";
import { LecturePlayer } from "@/components/lecture-player";
import { Quiz } from "@/components/quiz";
import { requestLessonResponse } from "@/lib/api-client";
import { useLearning } from "@/lib/learning-context";
import type { LessonResponse } from "@/lib/types";
import "@/app/learn/lesson.css";

export function LessonExperience({ moduleId }: { moduleId: string }) {
  const { state, ready, saveLesson, startModule, recordQuizResult } =
    useLearning();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [lessonMode, setLessonMode] = useState<LessonResponse["mode"] | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const pauseNarrationRef = useRef<(() => void) | null>(null);
  const pauseNarration = useCallback(() => pauseNarrationRef.current?.(), []);
  const requests = useRef(new Map<string, Promise<LessonResponse>>());
  const currentModule = state.plan?.modules.find(
    (item) => item.id === moduleId,
  );
  const lesson = state.lessons[moduleId];
  const moduleIndex =
    state.plan?.modules.findIndex((item) => item.id === moduleId) ?? -1;

  useEffect(() => {
    if (!ready || !currentModule || currentModule.status === "locked" || lesson)
      return;
    let active = true;
    let request = requests.current.get(currentModule.id);
    if (!request) {
      request = requestLessonResponse(currentModule);
      requests.current.set(currentModule.id, request);
    }
    void request
      .then((response) => {
        if (!active) return;
        setError("");
        setLessonMode(response.mode);
        saveLesson(response.lesson);
        startModule(currentModule.id);
      })
      .catch((cause: unknown) => {
        requests.current.delete(currentModule.id);
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "This lesson could not load. Please try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [ready, currentModule, lesson, saveLesson, startModule, attempt]);

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
                    setError("");
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
                <div className="lesson-main-grid">
                  <LecturePlayer
                    key={`player-${lesson.id}`}
                    lesson={lesson}
                    slideIndex={slideIndex}
                    onSlideChange={setSlideIndex}
                    pauseNarrationRef={pauseNarrationRef}
                  />
                  <LectureChat
                    key={`chat-${lesson.id}`}
                    lesson={lesson}
                    slideIndex={slideIndex}
                    onInteract={pauseNarration}
                  />
                </div>
                <div className="lesson-lower-grid">
                  <Quiz
                    key={lesson.id}
                    lesson={lesson}
                    previousResult={state.quizResults[moduleId]}
                    onComplete={recordQuizResult}
                  />
                  <aside className="lesson-resources">
                    <span className="eyebrow">GO A LITTLE DEEPER</span>
                    <h2>A few good resources.</h2>
                    <p className="muted">
                      A starting point for a curious mind.
                    </p>
                    {currentModule.resources.map((resource) => (
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
