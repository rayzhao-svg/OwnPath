"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "@/components/icon";
import type { Lesson } from "@/lib/types";

export function LecturePlayer({
  lesson,
  slideIndex,
  onSlideChange,
  pauseNarrationRef,
}: {
  lesson: Lesson;
  slideIndex: number;
  onSlideChange: (index: number) => void;
  pauseNarrationRef: RefObject<(() => void) | null>;
}) {
  const [playback, setPlayback] = useState<"idle" | "playing" | "paused">(
    "idle",
  );
  const [rate, setRate] = useState(1);
  const [notice, setNotice] = useState("");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const slide = lesson.slides[slideIndex];

  useEffect(() => {
    const pause = () => {
      if (utteranceRef.current && "speechSynthesis" in window) {
        window.speechSynthesis.pause();
        setPlayback("paused");
        setNotice("Narration paused for your question. Resume when you’re ready.");
      }
    };
    pauseNarrationRef.current = pause;
    return () => {
      if (pauseNarrationRef.current === pause) pauseNarrationRef.current = null;
    };
  }, [pauseNarrationRef]);

  useEffect(
    () => {
      const leavePage = () => {
        utteranceRef.current = null;
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        setPlayback("idle");
      };
      const hidePage = () => {
        if (document.hidden && utteranceRef.current && "speechSynthesis" in window) {
          window.speechSynthesis.pause();
          setPlayback("paused");
          setNotice("Narration paused while you were away. Resume when you’re ready.");
        }
      };
      window.addEventListener("pagehide", leavePage);
      document.addEventListener("visibilitychange", hidePage);
      return () => {
        window.removeEventListener("pagehide", leavePage);
        document.removeEventListener("visibilitychange", hidePage);
        utteranceRef.current = null;
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      };
    },
    [],
  );

  function stopNarration() {
    utteranceRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlayback("idle");
  }

  function changeSlide(index: number) {
    if (index < 0 || index >= lesson.slides.length) return;
    stopNarration();
    onSlideChange(index);
    setNotice("");
  }

  function togglePlayback() {
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      setNotice(
        "Your browser does not support narration. Read the transcript below to follow the lesson.",
      );
      return;
    }
    const speech = window.speechSynthesis;
    if (playback === "playing") {
      speech.pause();
      setPlayback("paused");
      return;
    }
    if (playback === "paused" && utteranceRef.current) {
      speech.resume();
      setPlayback("playing");
      setNotice("");
      return;
    }

    function speak(index: number) {
      const currentSlide = lesson.slides[index];
      if (!currentSlide) return;
      const utterance = new SpeechSynthesisUtterance(currentSlide.narration);
      utterance.rate = rate;
      utteranceRef.current = utterance;
      utterance.onend = () => {
        if (utteranceRef.current !== utterance) return;
        if (index + 1 < lesson.slides.length) {
          onSlideChange(index + 1);
          speak(index + 1);
        } else {
          utteranceRef.current = null;
          setPlayback("idle");
          setNotice(
            "You’ve reached the end of this lecture. Try the knowledge check below.",
          );
        }
      };
      utterance.onerror = () => {
        if (utteranceRef.current !== utterance) return;
        utteranceRef.current = null;
        setPlayback("idle");
        setNotice(
          "Narration could not play. Try again, or read the transcript below.",
        );
      };
      try {
        speech.speak(utterance);
      } catch {
        utteranceRef.current = null;
        setPlayback("idle");
        setNotice("Narration could not play. Read the transcript below to continue.");
      }
    }

    speech.cancel();
    setNotice("");
    setPlayback("playing");
    speak(slideIndex);
  }

  if (!slide)
    return <p role="status">There are no slides in this lesson yet.</p>;

  return (
    <section className="lecture-player" aria-label="Interactive lecture">
      <div className="lecture-slide">
        <div className="lecture-slide-topline">
          <span className="lecture-label">
            <span className="lecture-label-dot" /> OWN YOUR UNDERSTANDING
          </span>
          <span>
            {String(slideIndex + 1).padStart(2, "0")} /{" "}
            {String(lesson.slides.length).padStart(2, "0")}
          </span>
        </div>
        <div className="lecture-slide-content" aria-live="polite">
          <span className="lecture-chapter">
            {slideIndex === 0 ? "Let’s get started" : "One idea at a time"}
          </span>
          <h2>{slide.title}</h2>
          <ul>
            {slide.bullets.map((bullet, index) => (
              <li key={index}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {bullet}
              </li>
            ))}
          </ul>
        </div>
        <div className="lecture-slide-bottom">
          <span>YOUR PATH. YOUR PACE.</span>
          <Icon name="sparkles" size={22} />
        </div>
      </div>
      <div className="lecture-controls">
        <button
          type="button"
          className="lecture-play"
          onClick={togglePlayback}
          aria-label={
            playback === "playing"
              ? "Pause narration"
              : playback === "paused"
                ? "Resume narration"
                : "Play narration"
          }
        >
          <Icon name={playback === "playing" ? "pause" : "play"} size={18} />
        </button>
        <div className="lecture-playback-info">
          <strong>
            {playback === "playing"
              ? "Listening & learning"
              : playback === "paused"
                ? "Take your time"
                : "Listen to this lesson"}
          </strong>
          <span>
            Browser narration · slide {slideIndex + 1} of {lesson.slides.length}
          </span>
        </div>
        <label className="lecture-speed">
          <span className="sr-only">Narration speed</span>
          <select
            value={rate}
            onChange={(event) => {
              stopNarration();
              setRate(Number(event.target.value));
            }}
          >
            <option value={0.75}>0.75×</option>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
          </select>
        </label>
        <button
          className="lecture-icon-button"
          type="button"
          onClick={stopNarration}
          disabled={playback === "idle"}
          aria-label="Stop narration"
        >
          <Icon name="x" size={17} />
        </button>
      </div>
      <div
        className="lecture-progress"
        role="progressbar"
        aria-label="Slides viewed"
        aria-valuemin={0}
        aria-valuemax={lesson.slides.length}
        aria-valuenow={slideIndex + 1}
      >
        <span
          style={{
            width: `${((slideIndex + 1) / lesson.slides.length) * 100}%`,
          }}
        />
      </div>
      <div className="lecture-pagination">
        <button
          type="button"
          onClick={() => changeSlide(slideIndex - 1)}
          disabled={slideIndex === 0}
        >
          <Icon name="arrow-left" size={16} /> Previous
        </button>
        <div className="lecture-dots">
          {lesson.slides.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Go to slide ${index + 1}: ${item.title}`}
              aria-current={index === slideIndex ? "step" : undefined}
              onClick={() => changeSlide(index)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => changeSlide(slideIndex + 1)}
          disabled={slideIndex === lesson.slides.length - 1}
        >
          Next <Icon name="arrow-right" size={16} />
        </button>
      </div>
      {notice && (
        <p className="lecture-notice" role="status">
          {notice}
        </p>
      )}
      <details className="lecture-transcript">
        <summary>
          <Icon name="book" size={17} /> Read the transcript{" "}
          <span>Slide {slideIndex + 1}</span>
        </summary>
        <p>{slide.narration}</p>
      </details>
    </section>
  );
}
