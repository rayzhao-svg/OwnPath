type NarrationVoice = Pick<
  SpeechSynthesisVoice,
  "name" | "lang" | "voiceURI" | "default" | "localService"
>;

function voiceScore(voice: NarrationVoice): number {
  const identity = `${voice.name} ${voice.voiceURI}`;
  if (/amanda[\s_-]*multilingual/i.test(identity)) return 1000;
  if (/\bamanda\b/i.test(identity)) return 900;

  let score = /^en[-_]US$/i.test(voice.lang) ? 10 : 0;
  if (/natural|neural/i.test(identity)) score += 300;
  if (/premium|enhanced/i.test(identity)) score += 200;
  if (/(?:\b|[-_])(?:ava|emma|jenny|aria)(?:multilingual|\b)/i.test(identity)) score += 100;
  if (/\bsamantha\b/i.test(identity)) score += 80;
  if (/\b(?:karen|moira)\b/i.test(identity)) score += 30;
  if (/compact/i.test(identity)) score -= /super[-_ ]?compact/i.test(identity) ? 20 : 10;
  if (voice.default) score += 2;
  // These voices are intended as effects or characters rather than a clear narrator.
  if (/\b(?:albert|bad news|bahh|bells|boing|bubbles|cellos|fred|good news|jester|junior|organ|ralph|superstar|trinoids|whisper|wobble|zarvox)\b/i.test(identity)) score -= 500;
  return score;
}

/** Prefer a natural English narrator from the voices the browser actually exposes. */
export function chooseNarrationVoice<Voice extends NarrationVoice>(
  voices: readonly Voice[],
  preferredVoiceURI?: string,
): Voice | undefined {
  const english = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
  const preferred = preferredVoiceURI
    ? english.find((voice) => voice.voiceURI === preferredVoiceURI)
    : undefined;
  if (preferred) return preferred;

  // Sort a copy; callers may share the platform's list with a voice picker.
  return english.sort((a, b) => voiceScore(b) - voiceScore(a))[0];
}
