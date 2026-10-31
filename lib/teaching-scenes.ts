import type { Slide, TeachingScene } from "@/lib/types";

export interface TeachingFrame {
  slideIndex: number;
  sceneIndex: number;
  beatIndex: number;
  scene: TeachingScene;
  /** The exact text spoken for this visible beat. */
  narration: string;
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
  return slides.flatMap((slide, slideIndex) => getTeachingScenes(slide).flatMap((scene, sceneIndex) =>
    narrationBeats(scene.narration).map((narration, beatIndex) => ({ slideIndex, sceneIndex, beatIndex, scene, narration })),
  ));
}
