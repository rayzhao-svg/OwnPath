"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icon";
import { requestTutor } from "@/lib/api-client";
import type { Lesson, TutorMessage } from "@/lib/types";

export function LectureChat({ lesson }: { lesson: Lesson }) {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const generation = requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      // The API accepts at most 20 history messages. Keep long conversations usable.
      const response = await requestTutor(lesson, trimmed, messages.slice(-20));
      if (generation !== requestGeneration.current) return;
      const user: TutorMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      setMessages((previous) => [...previous, user, response]);
      setQuestion("");
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setQuestion(trimmed);
      setError(
        cause instanceof Error
          ? cause.message
          : "Your question could not be sent. Please try again.",
      );
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
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
        <span className="tutor-mode-badge">MOCK PREVIEW</span>
      </div>
      <div
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
                  `Can you explain ${lesson.slides[0]?.title ?? lesson.title} with a simple example?`,
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
                void ask("What are the key takeaways from this lesson?")
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
        <p className="tutor-error" role="alert">
          {error}
        </p>
      )}
      <form className="tutor-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="tutor-question">
          Ask about this lesson
        </label>
        <textarea
          id="tutor-question"
          rows={2}
          maxLength={2000}
          value={question}
          disabled={loading}
          onChange={(event) => setQuestion(event.target.value)}
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
        Practice responses use this lesson’s mock content.
      </p>
    </aside>
  );
}
