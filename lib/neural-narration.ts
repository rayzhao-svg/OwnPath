export type NeuralNarrationState = "idle" | "loading" | "playing" | "paused";

interface NarratedSlide { narration: string }
interface NarrationCallbacks {
  onState: (state: NeuralNarrationState) => void;
  onSlideChange: (index: number) => void;
  onNotice: (message: string) => void;
}
interface NarrationRuntime {
  fetch: typeof fetch;
  createAudio: () => HTMLAudioElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

/** Owns one lesson's audio, requests, and temporary clip URLs. Construct in the browser. */
export function createNeuralNarrationController(
  callbacks: NarrationCallbacks,
  suppliedRuntime: Partial<NarrationRuntime> = {},
) {
  const runtime: NarrationRuntime = {
    fetch: (...args) => fetch(...args),
    createAudio: () => new Audio(),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    ...suppliedRuntime,
  };
  const clips = new Map<string, string>();
  const downloads = new Map<string, { controller: AbortController; promise: Promise<string> }>();
  let audio: HTMLAudioElement | null = null;
  let pending: Promise<void> | null = null;
  let state: NeuralNarrationState = "idle";
  let slides: readonly NarratedSlide[] = [];
  let slideIndex = 0;
  let rate = 1;
  let generation = 0;
  let clipGeneration = 0;
  let playAttempt = 0;
  let wanted = false;
  let disposed = false;

  function setState(next: NeuralNarrationState) {
    state = next;
    if (!disposed) callbacks.onState(next);
  }

  function clearAudio() {
    playAttempt++;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    try { audio.currentTime = 0; } catch { /* No media may have loaded yet. */ }
    audio.removeAttribute("src");
    audio.load();
    audio = null;
  }

  function abortDownloads() {
    for (const download of downloads.values()) download.controller.abort();
    downloads.clear();
  }

  function stop() {
    generation++;
    clipGeneration++;
    wanted = false;
    abortDownloads();
    pending = null;
    clearAudio();
    setState("idle");
  }

  function valid(session: number, clip: number) {
    return !disposed && session === generation && clip === clipGeneration;
  }

  function fetchClip(text: string, session: number): Promise<string> {
    const cached = clips.get(text);
    if (cached) return Promise.resolve(cached);
    const downloading = downloads.get(text);
    if (downloading) return downloading.promise;
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(25_000);
    const task = (async () => {
      try {
        const response = await runtime.fetch("/api/narration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.any([controller.signal, timeout]),
          cache: "no-store",
        });
        if (disposed || session !== generation || controller.signal.aborted)
          throw new Error("Narration was canceled.");
        if (!response.ok) {
          let message = "Amanda narration could not be generated. Please try again.";
          try {
            const body: unknown = await response.json();
            if (body && typeof body === "object" && "error" in body) {
              const error = body.error;
              if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
                message = error.message.slice(0, 300);
              }
            }
          } catch { /* Keep the safe message for unreadable service errors. */ }
          throw new Error(message);
        }
        if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("audio/"))
          throw new Error("Amanda returned an unreadable audio clip. Please try again.");
        const blob = await response.blob();
        if (disposed || session !== generation || controller.signal.aborted)
          throw new Error("Narration was canceled.");
        if (!blob.size) throw new Error("Amanda returned an empty audio clip. Please try again.");
        const url = runtime.createObjectURL(blob);
        clips.set(text, url);
        while (clips.size > 8) {
          const oldest = clips.keys().next().value!;
          runtime.revokeObjectURL(clips.get(oldest)!);
          clips.delete(oldest);
        }
        return url;
      } catch (error) {
        if (timeout.aborted && !controller.signal.aborted)
          throw new Error("Amanda narration took too long. Press Play to retry, or choose a browser voice.");
        throw error;
      } finally {
        if (downloads.get(text)?.controller === controller) downloads.delete(text);
      }
    })();
    downloads.set(text, { controller, promise: task });
    return task;
  }

  function prefetchNext(session: number) {
    const text = slides[slideIndex + 1]?.narration;
    if (!text || disposed || session !== generation || !wanted || state !== "playing") return;
    // Only the next spoken frame is prepared. Its visual remains unchanged until
    // the active audio ends; failed preparation must not interrupt that audio.
    void fetchClip(text, session).catch(() => {});
  }

  async function startAudio(session: number, clip: number) {
    const player = audio;
    if (!player || !valid(session, clip) || !wanted) return;
    const attempt = ++playAttempt;
    setState("loading");
    try {
      // On cached clips this call remains in the user's click handler, before any await.
      await player.play();
      if (!valid(session, clip)) return;
      if (!wanted) { player.pause(); return; }
      if (attempt === playAttempt) {
        setState("playing");
        prefetchNext(session);
      }
    } catch (error) {
      if (!valid(session, clip) || attempt !== playAttempt || !wanted) return;
      wanted = false;
      setState("idle");
      callbacks.onNotice(error instanceof Error && error.name === "NotAllowedError"
        ? "Amanda’s audio is ready. Press Play again to allow audio in this browser."
        : "Amanda’s audio could not play. Press Play to retry, or read the transcript below.");
    }
  }

  async function loadSlide(session: number, clip: number) {
    const text = slides[slideIndex]?.narration;
    if (!text || !valid(session, clip)) return;
    let url = clips.get(text);
    try {
      if (url) {
        clips.delete(text);
        clips.set(text, url);
      } else {
        url = await fetchClip(text, session);
      }
      if (!valid(session, clip)) return;
      const player = runtime.createAudio();
      audio = player;
      player.src = url;
      player.preload = "auto";
      player.playbackRate = rate;
      player.preservesPitch = true;
      player.onended = () => {
        if (!valid(session, clip) || audio !== player || !wanted || state !== "playing") return;
        clearAudio();
        if (slideIndex + 1 < slides.length) {
          slideIndex++;
          callbacks.onSlideChange(slideIndex);
          beginSlide(session);
        } else {
          wanted = false;
          setState("idle");
          callbacks.onNotice("You’ve reached the end of this lecture. Try the knowledge check below.");
        }
      };
      player.onerror = () => {
        if (!valid(session, clip) || audio !== player) return;
        wanted = false;
        abortDownloads();
        clearAudio();
        // A failed decode should fetch a fresh clip on retry, not replay broken bytes.
        const failedURL = clips.get(text);
        if (failedURL) {
          clips.delete(text);
          runtime.revokeObjectURL(failedURL);
        }
        setState("idle");
        callbacks.onNotice("Amanda’s audio could not play. Press Play to retry, or read the transcript below.");
      };
      if (wanted) await startAudio(session, clip);
      else setState("paused");
    } catch (error) {
      if (!valid(session, clip)) return;
      wanted = false;
      setState("idle");
      callbacks.onNotice(error instanceof Error ? error.message : "Amanda narration could not be loaded. Please try again.");
    }
  }

  function beginSlide(session: number) {
    const clip = ++clipGeneration;
    setState(wanted ? "loading" : "paused");
    const task = loadSlide(session, clip);
    pending = task;
    void task.finally(() => { if (pending === task) pending = null; });
    return task;
  }

  async function play(nextSlides: readonly NarratedSlide[], index: number, nextRate = 1) {
    if (disposed) return;
    stop();
    if (!nextSlides[index]?.narration) return;
    slides = nextSlides;
    slideIndex = index;
    rate = nextRate;
    wanted = true;
    callbacks.onNotice("");
    await beginSlide(generation);
  }

  function pause() {
    if (disposed || state === "idle") return;
    wanted = false;
    playAttempt++;
    audio?.pause();
    setState("paused");
  }

  async function resume() {
    if (disposed || state !== "paused") return;
    wanted = true;
    callbacks.onNotice("");
    if (audio) await startAudio(generation, clipGeneration);
    else if (pending) { setState("loading"); await pending; }
  }

  function setRate(nextRate: number) {
    rate = nextRate;
    if (audio) audio.playbackRate = nextRate;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    for (const url of clips.values()) runtime.revokeObjectURL(url);
    clips.clear();
  }

  return { play, pause, resume, stop, setRate, dispose };
}

export type NeuralNarrationController = ReturnType<typeof createNeuralNarrationController>;
