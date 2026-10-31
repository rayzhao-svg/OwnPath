"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { diagnoseMistakes } from "@/lib/remediation";
import type { Lesson, QuizQuestion, QuizResult } from "@/lib/types";

export function Quiz({
  lesson,
  previousResult,
  latestResult,
  onComplete,
  onReview,
  onReviewWeakAreas,
  reviewDisabled = false,
  reviewBusy = false,
}: {
  lesson: Lesson;
  previousResult?: QuizResult;
  latestResult?: QuizResult;
  onComplete: (result: QuizResult) => void;
  onReview?: (question: string) => void;
  onReviewWeakAreas?: (result: QuizResult) => void;
  reviewDisabled?: boolean;
  reviewBusy?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState("");
  const allAnswered = lesson.quiz.every(
    (question) => answers[question.id] !== undefined,
  );
  const diagnosticCandidate = result ?? latestResult;
  const diagnosticResult = diagnosticCandidate?.lessonId === lesson.id &&
    diagnosticCandidate.moduleId === lesson.moduleId &&
    diagnosticCandidate.totalQuestions === lesson.quiz.length
    ? diagnosticCandidate : undefined;
  const mistakes = diagnosticResult
    ? diagnoseMistakes(lesson, diagnosticResult)
    : [];
  const missedQuestions = diagnosticResult?.answers
    ? lesson.quiz.filter((question) =>
        diagnosticResult.answers?.[question.id] !== question.correctAnswer)
    : [];

  function review(question: QuizQuestion) {
    const selectedAnswer = diagnosticResult?.answers?.[question.id];
    const prompt = `Help me understand this quiz question: ${question.question}\nMy answer: ${selectedAnswer === undefined ? "Not recorded" : question.options[selectedAnswer]}\nCorrect answer: ${question.options[question.correctAnswer]}\nExplanation: ${question.explanation}\nPlease explain my mistake using this lesson and give me a similar practice example.`;
    onReview?.(prompt.slice(0, 1800));
  }

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
      answers: { ...answers },
      missedQuestionIds: lesson.quiz
        .filter((question) => answers[question.id] !== question.correctAnswer)
        .map((question) => question.id),
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
      {previousResult && !result && (
        <p className={`quiz-previous${previousResult.passed ? "" : " quiz-previous-review"}`}>
          <Icon name={previousResult.passed ? "check" : "book"} size={17} />
          {previousResult.passed
            ? `You’ve already passed this module with ${previousResult.score}%. You can practice again below.`
            : `Your saved score is ${previousResult.score}%. Review your weak areas, then try the questions again below.`}
        </p>
      )}
      {!result && diagnosticResult && !diagnosticResult.passed && (
        <p className="quiz-previous quiz-previous-review">
          <Icon name="book" size={17} />
          Latest attempt: {diagnosticResult.score}%.
          {diagnosticResult.answers
            ? " Your targeted review focuses on the concepts you missed."
            : " Take the quiz again to identify specific gaps; earlier attempts did not record individual answers."}
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
        {missedQuestions.length > 0 && (
          <section className="quiz-review" aria-labelledby="quiz-review-title">
            <h3 id="quiz-review-title">Focus your next review</h3>
            <p>
              {diagnosticResult?.passed
                ? "You passed this assessment. These optional review points can strengthen your understanding."
                : "These answers show which ideas need another look. Work through your targeted review before retrying the assessment."}
            </p>
            {onReviewWeakAreas && diagnosticResult && (
              <button
                type="button"
                className="button button-primary button-small"
                aria-busy={reviewBusy}
                onClick={() => onReviewWeakAreas(diagnosticResult)}
              >
                Review weak areas <Icon name="book" size={15} />
              </button>
            )}
            <ul>
              {missedQuestions.map((question) => (
                <li key={question.id}>
                  <span className="eyebrow">
                    {mistakes.find((mistake) => mistake.questionId === question.id)?.concept || lesson.title}
                  </span>
                  <strong>{question.question}</strong>
                  <p>
                    Your answer: {question.options[diagnosticResult?.answers?.[question.id] ?? -1] || "Not recorded"}
                  </p>
                  <p>Correct answer: {question.options[question.correctAnswer]}</p>
                  {!result && <p>{question.explanation}</p>}
                  {onReview && (
                    <button
                      type="button"
                      disabled={reviewDisabled}
                      onClick={() => review(question)}
                    >
                      Review this question with tutor <Icon name="chat" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
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
                  ? "This module is complete. Return to your path to see available modules."
                  : "Review the explanations and try again when you’re ready."}
              </p>
              {!result.passed && previousResult?.passed && (
                <p className="quiz-saved-pass">
                  Your earlier passing score of {previousResult.score}% remains saved.
                </p>
              )}
              <div className="quiz-result-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setResult(null);
                    setAnswers({});
                    setError("");
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
