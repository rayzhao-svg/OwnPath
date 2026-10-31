import type { Slide, TeachingScene } from "@/lib/types";

export interface TeachingFrame {
  slideIndex: number;
  sceneIndex: number;
  beatIndex: number;
  /** The authored visual line explained by this audio clip. Never inferred from playback progress. */
  visualLineIndex: number;
  scene: TeachingScene;
  /** The exact text spoken for this visible beat. */
  narration: string;
}

/**
 * Older saved scenes have only one narration paragraph. Divide its existing
 * words into ordered line explanations without dropping or repeating content.
 * New scenes author this correspondence directly with lineNarrations.
 */
export function teachingLineNarrations(scene: TeachingScene): string[] {
  if (scene.lineNarrations?.length === scene.visual.lines.length && scene.lineNarrations.every((text) => text.trim()))
    return scene.lineNarrations;
  const words = scene.narration.trim().split(/\s+/u).filter(Boolean);
  const count = Math.min(scene.visual.lines.length, words.length);
  const parts: string[] = [];
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * words.length / count);
    const end = Math.floor((index + 1) * words.length / count);
    parts.push(words.slice(start, end).join(" "));
  }
  return parts;
}

/** Split at sentence whitespace, never inside a decimal or a dotted identifier. */
export function narrationBeats(text: string, maxLength = 280): string[] {
  const sentences = text.trim().split(/(?<=[.!?])\s+(?=[A-Z“"'‘])/u).filter(Boolean);
  const beats: string[] = [];
  for (const sentence of sentences) {
    // Long code examples and punctuation-free text still receive readable beats.
    const words = sentence.split(/\s+/u);
    let chunk = "";
    for (const word of words) {
      if (chunk && chunk.length + word.length + 1 > maxLength) {
        beats.push(chunk);
        chunk = "";
      }
      chunk = chunk ? `${chunk} ${word}` : word;
    }
    if (chunk) {
      const last = beats[beats.length - 1];
      if (last && last.length < 110 && last.length + chunk.length + 1 <= maxLength)
        beats[beats.length - 1] = `${last} ${chunk}`;
      else beats.push(chunk);
    }
  }
  return beats;
}

/** Legacy lessons animate immediately using only their existing teaching text. */
export function getTeachingScenes(slide: Slide): TeachingScene[] {
  if (slide.scenes?.length) return slide.scenes;
  const beats = narrationBeats(slide.narration, 650);
  return beats.map((narration, index) => ({
    title: (slide.bullets[index] ?? slide.title).slice(0, 80),
    narration,
    visual: {
      kind: "concept",
      lines: [narration.slice(0, 250)],
    },
  }));
}

/** Frames are runtime data: narration is never duplicated again in saved JSON. */
export function createTeachingFrames(slides: readonly Slide[]): TeachingFrame[] {
  return slides.flatMap((slide, slideIndex) => getTeachingScenes(slide).flatMap((scene, sceneIndex) => {
    let beatIndex = 0;
    return teachingLineNarrations(scene).flatMap((explanation, visualLineIndex) =>
      narrationBeats(explanation).map((narration) => ({ slideIndex, sceneIndex, beatIndex: beatIndex++, visualLineIndex, scene, narration })),
    );
  }));
}
