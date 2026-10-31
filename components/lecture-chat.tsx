"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icon";
import { requestTutorResponse } from "@/lib/api-client";
import type { ChatResponse, Lesson, TutorMessage } from "@/lib/types";

export function LectureChat({
  lesson,
  slideIndex,
  onInteract,
}: {
  lesson: Lesson;
  slideIndex: number;
  onInteract: () => void;
}) {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ChatResponse["mode"] | null>(null);
  const requestGeneration = useRef(0);
  const pending = useRef(false);
  const requestHistory = useRef<TutorMessage[]>([]);
  const [failedQuestion, setFailedQuestion] = useState<{ text: string; slideId: string } | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const currentSlide = lesson.slides[slideIndex] ?? lesson.slides[0];
  const prefix = `[OwnPath slide: ${currentSlide.id}]\n`;
  const maxQuestionLength = 2000 - prefix.length;

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, loading]);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );

  async function ask(text: string, slideId = currentSlide.id) {
    const trimmed = text.trim();
    if (!trimmed || pending.current) return;
    const contextualQuestion = `[OwnPath slide: ${slideId}]\n${trimmed}`;
    if (contextualQuestion.length > 2000) {
      setError(`Please shorten your question to ${maxQuestionLength} characters.`);
      return;
    }
    onInteract();
    const generation = requestGeneration.current;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      // Keep slide context in API history without displaying its technical prefix.
      const response = await requestTutorResponse(
        lesson, contextualQuestion, requestHistory.current.slice(-20),
      );
      if (generation !== requestGeneration.current) return;
      const user: TutorMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      requestHistory.current = [
        ...requestHistory.current,
        { ...user, content: contextualQuestion },
        response.message,
      ].slice(-20);
      setMessages((previous) => [...previous, user, response.message].slice(-100));
      setMode(response.mode);
      setFailedQuestion(null);
      setQuestion("");
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setQuestion(trimmed);
      setFailedQuestion({ text: trimmed, slideId });
      setError(
        cause instanceof Error
          ? cause.message
          : "Your question could not be sent. Please try again.",
      );
    } finally {
      if (generation === requestGeneration.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <aside className="lecture-chat card" aria-label="Lesson tutor">
      <div className="tutor-heading">
        <span className="tutor-avatar">
          <Icon name="sparkles" size={21} />
        </span>
        <div>
          <h2>Your learning companion</h2>
          <p>Make the tricky parts click.</p>
        </div>
      </div>
      <div className="tutor-mode">
        <span /> Contextual tutor{" "}
        <span className="tutor-mode-badge">
          {mode === "claude" ? "CLAUDE" : mode === "mock" ? "MOCK PREVIEW" : "READY"}
        </span>
      </div>
      <p className="tutor-slide-context">
        Slide {slideIndex + 1}: {currentSlide.title}
      </p>
      <div
        ref={conversationRef}
        className="tutor-conversation"
        role="log"
        aria-label="Tutor conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <div className="tutor-welcome">
            <div className="tutor-welcome-icon">
              <Icon name="chat" size={26} />
            </div>
            <h3>A little clarity goes a long way.</h3>
            <p>
              Ask a question about this lesson. I’ll help you connect the ideas,
              one step at a time.
            </p>
            <button
              type="button"
              className="tutor-suggestion"
              disabled={loading}
              onClick={() =>
                void ask(
                  `Can you explain ${currentSlide.title} with a simple example?`,
                )
              }
            >
              Explain it with an example <Icon name="arrow-right" size={15} />
            </button>
            <button
              type="button"
              className="tutor-suggestion"
              disabled={loading}
              onClick={() =>
                void ask("What are the key takeaways from this slide?")
              }
            >
              What should I remember? <Icon name="arrow-right" size={15} />
            </button>
          </div>
        ) : (
          messages.map((message) => (
            <div
              className={`tutor-message tutor-message-${message.role}`}
              key={message.id}
            >
              <span>{message.role === "user" ? "YOU" : "OWNPATH TUTOR"}</span>
              <p>{message.content}</p>
            </div>
          ))
        )}
        {loading && (
          <div className="tutor-thinking" role="status">
            Finding a little clarity<span>…</span>
          </div>
        )}
      </div>
      {error && (
        <div className="tutor-error" role="alert">
          <p>{error}</p>
          {failedQuestion && (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                const failed = failedQuestion;
                if (failed) void ask(failed.text, failed.slideId);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
      <form className="tutor-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="tutor-question">
          Ask about this lesson
        </label>
        <textarea
          id="tutor-question"
          rows={2}
          maxLength={maxQuestionLength}
          value={question}
          disabled={loading}
          onFocus={onInteract}
          onChange={(event) => {
            setQuestion(event.target.value);
            setError("");
            setFailedQuestion(null);
          }}
          placeholder="What’s on your mind?"
        />
        <button
          type="submit"
          aria-label="Send question"
          disabled={loading || !question.trim()}
        >
          <Icon name="send" size={18} />
        </button>
      </form>
      <p className="tutor-footnote">
        {mode === "mock"
          ? "Practice responses use this lesson’s content."
          : "Ask anytime. Narration pauses while you ask; resume when ready."}
      </p>
    </aside>
  );
}
