"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Icon } from "@/components/icon";
import { chooseNarrationVoice } from "@/lib/narration-voice";
import { createNeuralNarrationController, type NeuralNarrationController, type NeuralNarrationState } from "@/lib/neural-narration";
import { createTeachingFrames, getTeachingScenes } from "@/lib/teaching-scenes";
import type { Lesson } from "@/lib/types";

const VOICE_PREFERENCE_KEY = "ownpath:narration-voice:v1";
const NARRATION_SOURCE_KEY = "ownpath:narration-source:v1";

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
  const [playback, setPlaybackState] = useState<NeuralNarrationState>("idle");
  const playbackRef = useRef<NeuralNarrationState>("idle");
  const setPlayback = useCallback((value: NeuralNarrationState) => {
    playbackRef.current = value;
    setPlaybackState(value);
  }, []);
  const [source, setSource] = useState<"amanda" | "browser">("amanda");
  const sourceRef = useRef<"amanda" | "browser">("amanda");
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable">("checking");
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [preferredVoiceURI, setPreferredVoiceURI] = useState("");
  const [notice, setNotice] = useState("");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const neuralRef = useRef<NeuralNarrationController | null>(null);
  const onSlideChangeRef = useRef(onSlideChange);
  const activeSlideRef = useRef(slideIndex);
  const frames = useMemo(() => createTeachingFrames(lesson.slides), [lesson.slides]);
  const sequenceKey = useMemo(() => JSON.stringify([lesson.id, lesson.slides]), [lesson.id, lesson.slides]);
  const [framePosition, setFramePosition] = useState({ key: "", index: 0 });
  const framesRef = useRef(frames);
  const sequenceKeyRef = useRef(sequenceKey);
  const candidateIndex = framePosition.key === sequenceKey ? framePosition.index : 0;
  const frameIndex = frames[candidateIndex]?.slideIndex === slideIndex ? candidateIndex
    : Math.max(0, frames.findIndex((item) => item.slideIndex === slideIndex));
  const frame = frames[frameIndex];
  const slide = lesson.slides[slideIndex];
  const scenes = slide ? getTeachingScenes(slide) : [];
  const scene = frame?.scene;
  const sceneFrames = frame ? frames.filter((item) => item.slideIndex === slideIndex && item.sceneIndex === frame.sceneIndex) : [];
  const sceneFrameIndex = frame ? sceneFrames.indexOf(frame) : 0;
  const activeLine = scene ? sceneFrames.length === 1 ? scene.visual.lines.length - 1
    : Math.round(sceneFrameIndex * (scene.visual.lines.length - 1) / Math.max(1, sceneFrames.length - 1)) : 0;
  const selectedVoice = chooseNarrationVoice(voices, preferredVoiceURI);
  const recommendedVoice = chooseNarrationVoice(voices);
  const englishVoices = voices
    .filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => { onSlideChangeRef.current = onSlideChange; }, [onSlideChange]);
  useEffect(() => { framesRef.current = frames; sequenceKeyRef.current = sequenceKey; }, [frames, sequenceKey]);

  const showFrame = useCallback((index: number) => {
    const next = framesRef.current[index];
    if (!next) return;
    activeSlideRef.current = next.slideIndex;
    setFramePosition({ key: sequenceKeyRef.current, index });
    onSlideChangeRef.current(next.slideIndex);
  }, []);

  useEffect(() => {
    const controller = createNeuralNarrationController({
      onState: setPlayback,
      onSlideChange: showFrame,
      onNotice: setNotice,
    });
    neuralRef.current = controller;
    queueMicrotask(() => { if (neuralRef.current === controller) setPlayback("idle"); });
    return () => {
      controller.dispose();
      utteranceRef.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (neuralRef.current === controller) neuralRef.current = null;
    };
  }, [sequenceKey, setPlayback, showFrame]);

  useEffect(() => {
    // Tutor and review links can change the chapter outside this player's controls.
    if (activeSlideRef.current === slideIndex) return;
    activeSlideRef.current = slideIndex;
    neuralRef.current?.stop();
    utteranceRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    queueMicrotask(() => setPlayback("idle"));
  }, [slideIndex, setPlayback]);

  const checkConnection = useCallback(async (signal?: AbortSignal) => {
    setAvailability("checking");
    try {
      const response = await fetch("/api/narration", { cache: "no-store", signal });
      const status: unknown = await response.json();
      if (signal?.aborted) return;
      const available = response.ok && status !== null && typeof status === "object" &&
        "available" in status && status.available === true &&
        "voiceId" in status && status.voiceId === "en-US-AmandaMultilingualNeural";
      setAvailability(available ? "ready" : "unavailable");
    } catch {
      if (!signal?.aborted) setAvailability("unavailable");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      try {
        const saved = window.localStorage.getItem(NARRATION_SOURCE_KEY);
        if (saved === "browser" || saved === "amanda") {
          sourceRef.current = saved;
          setSource(saved);
        }
      } catch { /* Amanda remains the default when storage is unavailable. */ }
      void checkConnection(controller.signal);
    });
    return () => controller.abort();
  }, [checkConnection]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const speech = window.speechSynthesis;
    let active = true;
    const updateVoices = () => {
      if (active) setVoices(speech.getVoices?.() ?? []);
    };
    // Some browsers populate their voices only after the first page render.
    queueMicrotask(() => {
      if (!active) return;
      try {
        setPreferredVoiceURI(window.localStorage.getItem(VOICE_PREFERENCE_KEY) || "");
      } catch {
        // Voice selection still works when browser storage is unavailable.
      }
      updateVoices();
    });
    speech.addEventListener?.("voiceschanged", updateVoices);
    return () => {
      active = false;
      speech.removeEventListener?.("voiceschanged", updateVoices);
    };
  }, []);

  useEffect(() => {
    const pause = () => {
      if (sourceRef.current === "amanda" && playbackRef.current !== "idle") {
        neuralRef.current?.pause();
        setNotice("Narration paused for your question. Resume when you’re ready.");
      } else if (utteranceRef.current && "speechSynthesis" in window) {
        window.speechSynthesis.pause();
        setPlayback("paused");
        setNotice("Narration paused for your question. Resume when you’re ready.");
      }
    };
    pauseNarrationRef.current = pause;
    return () => {
      if (pauseNarrationRef.current === pause) pauseNarrationRef.current = null;
    };
  }, [pauseNarrationRef, setPlayback]);

  useEffect(
    () => {
      const leavePage = () => {
        neuralRef.current?.stop();
        utteranceRef.current = null;
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        setPlayback("idle");
      };
      const hidePage = () => {
        if (document.hidden && playbackRef.current !== "idle") {
          if (sourceRef.current === "amanda") neuralRef.current?.pause();
          else if (utteranceRef.current && "speechSynthesis" in window) {
            window.speechSynthesis.pause();
            setPlayback("paused");
          }
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
    [setPlayback],
  );

  function stopNarration() {
    neuralRef.current?.stop();
    utteranceRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlayback("idle");
  }

  function changeSlide(index: number) {
    if (index < 0 || index >= lesson.slides.length) return;
    stopNarration();
    showFrame(frames.findIndex((item) => item.slideIndex === index));
    setNotice("");
  }

  function changeFrame(index: number) {
    if (!frames[index]) return;
    stopNarration();
    showFrame(index);
    setNotice("");
  }

  function togglePlayback() {
    if (source === "amanda") {
      if (availability !== "ready") {
        setNotice("Amanda is not connected yet. You can read the transcript or choose a browser voice.");
        return;
      }
      const controller = neuralRef.current;
      if (!controller) return;
      if (playback === "playing" || playback === "loading") controller.pause();
      else if (playback === "paused") void controller.resume();
      else void controller.play(frames, frameIndex, rate);
      return;
    }
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
      const currentFrame = frames[index];
      if (!currentFrame) return;
      const utterance = new SpeechSynthesisUtterance(currentFrame.narration);
      utterance.rate = rate;
      const voice = chooseNarrationVoice(speech.getVoices?.() ?? voices, preferredVoiceURI);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || "en-US";
      utteranceRef.current = utterance;
      utterance.onend = () => {
        if (utteranceRef.current !== utterance) return;
        if (index + 1 < frames.length) {
          showFrame(index + 1);
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
    // Cancel clears the queue but preserves SpeechSynthesis's global pause state.
    // A fresh explanation must also leave that state before it can be spoken.
    if (speech.paused) speech.resume();
    setNotice("");
    setPlayback("playing");
    speak(frameIndex);
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
        <div className="lecture-slide-content teaching-content">
          <span className="lecture-chapter">
            {slideIndex === 0 ? "Let’s get started" : "One idea at a time"}
          </span>
          <h2>{slide.title}</h2>
          {scene && frame && <>
            <div className="teaching-scene-heading">
              <span>STEP {String(frame.sceneIndex + 1).padStart(2, "0")} / {String(scenes.length).padStart(2, "0")}</span>
              <h3>{scene.title}</h3>
            </div>
            <div className={`teaching-visual teaching-visual-${scene.visual.kind}`} key={`${sequenceKey}:${slideIndex}:${frame.sceneIndex}`} aria-label={`${scene.visual.kind} illustration`}>
              <span className="teaching-visual-label">{scene.visual.kind === "code" ? "Follow the code" : scene.visual.kind === "calculation" ? "Work it through" : scene.visual.kind === "comparison" ? "Compare the approaches" : "Connect the ideas"}</span>
              <div className="teaching-visual-lines">
                {scene.visual.lines.map((line, index) => <div
                  className={`teaching-visual-line${index === activeLine ? " is-active" : index < activeLine ? " is-complete" : " is-next"}`}
                  key={index}
                >
                  <span className="teaching-line-number">{String(index + 1).padStart(2, "0")}</span>
                  {scene.visual.kind === "code" ? <code>{line}</code> : <span>{line}</span>}
                </div>)}
              </div>
            </div>
            <div className="teaching-caption" aria-live="off">
              <span>{playback === "playing" ? "NOW EXPLAINING" : "FOLLOW ALONG"} · {sceneFrameIndex + 1} / {sceneFrames.length}</span>
              <p key={`${sequenceKey}:${frameIndex}`}>{frame.narration}</p>
            </div>
            <div className="teaching-step-controls">
              <button type="button" aria-label="Previous explanation" disabled={frameIndex === 0} onClick={() => changeFrame(frameIndex - 1)}><Icon name="arrow-left" size={14} /> Back a little</button>
              <div className="teaching-step-dots" aria-label="Teaching steps">
                {scenes.map((item, index) => <button key={index} type="button" aria-label={`Go to step ${index + 1}: ${item.title}`} aria-current={index === frame.sceneIndex ? "step" : undefined} onClick={() => changeFrame(frames.findIndex((entry) => entry.slideIndex === slideIndex && entry.sceneIndex === index))} />)}
              </div>
              <button type="button" aria-label="Next explanation" disabled={frameIndex === frames.length - 1} onClick={() => changeFrame(frameIndex + 1)}>Next part <Icon name="arrow-right" size={14} /></button>
            </div>
          </>}
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
          disabled={source === "amanda" && availability !== "ready"}
          aria-label={
            playback === "playing" || playback === "loading"
              ? "Pause narration"
              : playback === "paused"
                ? "Resume narration"
                : "Play narration"
          }
        >
          <Icon name={playback === "playing" || playback === "loading" ? "pause" : "play"} size={18} />
        </button>
        <div className="lecture-playback-info">
          <strong>
            {playback === "loading"
              ? "Preparing Amanda’s narration…"
              : playback === "playing"
              ? "Listening & learning"
              : playback === "paused"
                ? "Take your time"
                : "Listen to this lesson"}
          </strong>
          <span>
            {source === "amanda" ? "Amanda Multilingual" : selectedVoice?.name || "Browser narration"} · slide {slideIndex + 1} of {lesson.slides.length}{frame ? ` · step ${frame.sceneIndex + 1} of ${scenes.length}` : ""}
          </span>
        </div>
        <label className="lecture-speed">
          <span className="sr-only">Narration speed</span>
          <select
            value={rate}
            onChange={(event) => {
              const nextRate = Number(event.target.value);
              if (source === "amanda") neuralRef.current?.setRate(nextRate);
              else stopNarration();
              setRate(nextRate);
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
        <label className="lecture-voice">
          <span>Voice</span>
          <select
            aria-label="Narration voice"
            value={source === "amanda" ? "amanda" : englishVoices.some((voice) => voice.voiceURI === preferredVoiceURI) ? `browser:${preferredVoiceURI}` : "browser"}
            onChange={(event) => {
              stopNarration();
              setNotice("");
              const choice = event.target.value;
              const nextSource = choice === "amanda" ? "amanda" : "browser";
              const preference = choice.startsWith("browser:") ? choice.slice(8) : "";
              sourceRef.current = nextSource;
              setSource(nextSource);
              setPreferredVoiceURI(preference);
              try {
                window.localStorage.setItem(NARRATION_SOURCE_KEY, nextSource);
                if (preference) window.localStorage.setItem(VOICE_PREFERENCE_KEY, preference);
                else window.localStorage.removeItem(VOICE_PREFERENCE_KEY);
              } catch {
                // Keep the choice for this lesson even when it cannot be saved.
              }
            }}
          >
            <option value="amanda">Amanda Multilingual{availability === "unavailable" ? " · not connected" : ""}</option>
            <optgroup label="Browser voices">
            <option value="browser">Browser narration{recommendedVoice ? ` · ${recommendedVoice.name}` : ""}</option>
            {englishVoices.map((voice) => (
              <option key={voice.voiceURI} value={`browser:${voice.voiceURI}`}>
                {voice.name}{/premium/i.test(voice.voiceURI) ? " (Premium)" : /enhanced/i.test(voice.voiceURI) ? " (Enhanced)" : ""} · {voice.lang}
              </option>
            ))}
            </optgroup>
          </select>
        </label>
      {source === "amanda" && availability !== "ready" && (
        <p className="lecture-notice" role="status">
          {availability === "checking" ? "Checking Amanda’s connection…" : "Amanda narration is waiting for setup. You can read the transcript or choose a browser voice."}
          {availability === "unavailable" && <button type="button" className="narration-reconnect" onClick={() => { void checkConnection(); }}>Check connection</button>}
        </p>
      )}
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
        {scenes.map((item, index) => <div className="teaching-transcript-part" key={index}>
          <h3>{index + 1}. {item.title}</h3>
          <p>{item.narration}</p>
        </div>)}
      </details>
    </section>
  );
}
