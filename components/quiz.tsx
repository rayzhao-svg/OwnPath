"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import type { Lesson, QuizResult } from "@/lib/types";

export function Quiz({
  lesson,
  previousResult,
  onComplete,
}: {
  lesson: Lesson;
  previousResult?: QuizResult;
  onComplete: (result: QuizResult) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState("");
  const allAnswered = lesson.quiz.every(
    (question) => answers[question.id] !== undefined,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allAnswered) {
      setError(
        "Choose one answer for each question before checking your understanding.",
      );
      return;
    }
    const correctAnswers = lesson.quiz.filter(
      (question) => answers[question.id] === question.correctAnswer,
    ).length;
    const score = Math.round((correctAnswers / lesson.quiz.length) * 100);
    const nextResult: QuizResult = {
      lessonId: lesson.id,
      moduleId: lesson.moduleId,
      score,
      correctAnswers,
      totalQuestions: lesson.quiz.length,
      passed: score >= 70,
      completedAt: new Date().toISOString(),
    };
    setResult(nextResult);
    setError("");
    onComplete(nextResult);
  }

  return (
    <section
      className="lesson-quiz card"
      id="knowledge-check"
      aria-labelledby="knowledge-check-title"
    >
      <div className="quiz-heading">
        <div>
          <span className="eyebrow">A MOMENT TO REFLECT</span>
          <h2 id="knowledge-check-title">Let’s make it stick.</h2>
          <p className="muted">
            {lesson.quiz.length} questions · 70% to complete this module ·
            Retake anytime
          </p>
        </div>
        <span className="quiz-heading-icon">
          <Icon name="target" size={25} />
        </span>
      </div>
      {previousResult?.passed && !result && (
        <p className="quiz-previous">
          <Icon name="check" size={17} /> You’ve already passed this module with{" "}
          {previousResult.score}%. You can practice again below.
        </p>
      )}
      <form onSubmit={submit}>
        {lesson.quiz.map((question, questionIndex) => (
          <fieldset
            key={question.id}
            className="quiz-question"
            disabled={!!result}
          >
            <legend>
              <span>{String(questionIndex + 1).padStart(2, "0")}</span>
              {question.question}
            </legend>
            <div className="quiz-options">
              {question.options.map((option, optionIndex) => {
                const selected = answers[question.id] === optionIndex;
                const correct =
                  !!result && question.correctAnswer === optionIndex;
                const incorrect = !!result && selected && !correct;
                return (
                  <label
                    key={optionIndex}
                    className={`quiz-option${selected ? " quiz-option-selected" : ""}${correct ? " quiz-option-correct" : ""}${incorrect ? " quiz-option-incorrect" : ""}`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={optionIndex}
                      checked={selected}
                      onChange={() =>
                        setAnswers((previous) => ({
                          ...previous,
                          [question.id]: optionIndex,
                        }))
                      }
                    />
                    <span>{option}</span>
                    {correct && <Icon name="check" size={17} />}
                  </label>
                );
              })}
            </div>
            {result && (
              <p className="quiz-explanation">
                <strong>
                  {answers[question.id] === question.correctAnswer
                    ? "That’s right. "
                    : "A little more practice. "}
                </strong>
                {question.explanation}
              </p>
            )}
          </fieldset>
        ))}
        {error && (
          <p className="tutor-error" role="alert">
            {error}
          </p>
        )}
        {!result ? (
          <div className="quiz-submit">
            <span>
              {Object.keys(answers).length} of {lesson.quiz.length} answered
            </span>
            <button className="button button-primary" type="submit">
              Check my understanding <Icon name="arrow-right" size={17} />
            </button>
          </div>
        ) : (
          <div
            className={`quiz-result${result.passed ? " quiz-result-passed" : ""}`}
            role="status"
          >
            <div className="quiz-result-score">
              {result.score}
              <span>%</span>
            </div>
            <div>
              <h3>
                {result.passed
                  ? "A step forward. Well earned."
                  : "You’re still making progress."}
              </h3>
              <p>
                {result.correctAnswers} of {result.totalQuestions} correct.{" "}
                {result.passed
                  ? "This module is complete. Your next step is ready."
                  : "Review the explanations and try again when you’re ready."}
              </p>
              <div className="quiz-result-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setResult(null);
                    setAnswers({});
                  }}
                >
                  <Icon name="refresh" size={16} /> Practice again
                </button>
                {result.passed && (
                  <Link href="/dashboard" className="button button-primary">
                    Back to my path <Icon name="arrow-right" size={16} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
