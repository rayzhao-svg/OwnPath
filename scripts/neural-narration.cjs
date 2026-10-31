/* eslint-disable @typescript-eslint/no-require-imports */
/** Neural narration regressions exercise real lifecycle code with fake browser audio. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../lib/neural-narration.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const item = { exports: {} };
new Function('exports', 'module', output)(item.exports, item);
const { createNeuralNarrationController } = item.exports;
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const settle = () => new Promise(setImmediate);
const slides = [{ narration: 'First slide narration.' }, { narration: 'Second slide narration.' }];
const clip = () => ({ ok: true, headers: new Headers({ 'Content-Type': 'audio/mpeg' }), blob: async () => new Blob(['fake-mp3'], { type: 'audio/mpeg' }) });

function harness() {
  const states = [], indices = [], notices = [], requests = [], audios = [], created = [], revoked = [];
  let nextPlay = () => Promise.resolve();
  class FakeAudio {
    constructor() { this.currentTime = 0; this.src = ''; this.pauses = 0; this.loads = 0; this.plays = 0; audios.push(this); }
    play() { this.plays++; return nextPlay(); }
    pause() { this.pauses++; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() { this.loads++; }
  }
  const controller = createNeuralNarrationController({
    onState: state => states.push(state), onSlideChange: index => indices.push(index), onNotice: notice => notices.push(notice),
  }, {
    fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })),
    createAudio: () => new FakeAudio(),
    createObjectURL: blob => { const url = `blob:clip-${created.length + 1}`; created.push({ url, blob }); return url; },
    revokeObjectURL: url => revoked.push(url),
  });
  return { controller, states, indices, notices, requests, audios, created, revoked, setPlay: value => { nextPlay = value; } };
}

async function journeys() {
  const normal = harness();
  equal(normal.audios.length, 0, 'Construction does not access Audio or create a media element');
  const play = normal.controller.play(slides, 0, 1.25);
  equal(normal.states.at(-1), 'loading', 'A new slide reports loading while synthesis is pending');
  equal(normal.requests[0].url, '/api/narration', 'Audio is requested through the local server');
  equal(JSON.parse(normal.requests[0].init.body), { text: slides[0].narration }, 'Only the selected narration text is sent');
  normal.requests[0].resolve(clip()); await play;
  equal(normal.states.at(-1), 'playing', 'Playback starts only after Audio.play resolves');
  equal(normal.audios[0].playbackRate, 1.25, 'Narration respects the selected speed');
  equal(normal.audios[0].preservesPitch, true, 'Changing speed preserves the narrator’s pitch');
  normal.audios[0].currentTime = 9;
  normal.controller.pause();
  equal(normal.states.at(-1), 'paused', 'Pause exposes the paused state');
  await normal.controller.resume();
  equal(normal.audios[0].currentTime, 9, 'Resume retains the current audio position');
  equal(normal.requests.length, 2, 'Resume shares the current audio and its one-frame lookahead');
  const staleEnd = normal.audios[0].onended;
  staleEnd(); await settle();
  equal(normal.indices, [1], 'Finishing a slide advances the lesson once');
  equal(normal.requests.length, 2, 'The next frame shares its pending lookahead request');
  staleEnd(); equal(normal.indices, [1], 'A stale ending callback cannot advance a second time');
  normal.requests[1].resolve(clip()); await settle();
  normal.audios[1].onended();
  equal(normal.states.at(-1), 'idle', 'The last slide returns to idle');
  check(normal.notices.at(-1).includes('reached the end'), 'The learner receives the lecture completion notice');
  await normal.controller.play(slides, 0);
  equal(normal.requests.length, 2, 'Replaying a generated slide reuses its temporary audio');
  normal.controller.stop();
  equal(normal.audios.at(-1).currentTime, 0, 'Stop resets the audio position');
  normal.controller.dispose();
  equal(normal.revoked.length, 2, 'Disposal releases every cached object URL');

  const paused = harness();
  const waiting = paused.controller.play(slides, 0);
  paused.controller.pause(); paused.requests[0].resolve(clip()); await waiting;
  equal(paused.audios[0].plays, 0, 'Pausing during synthesis prevents delayed autoplay');
  equal(paused.states.at(-1), 'paused', 'The completed clip stays paused until the learner resumes');
  await paused.controller.resume();
  equal(paused.audios[0].plays, 1, 'Resume plays the fetched clip');
  equal(paused.requests.length, 2, 'Resume prepares only one next frame without duplicating the current generation');
  paused.controller.dispose();

  const resumed = harness();
  const beforeLoad = resumed.controller.play(slides, 0);
  resumed.controller.pause(); const resumeBeforeLoad = resumed.controller.resume();
  equal(resumed.requests.length, 1, 'Resume while still loading shares the pending request');
  resumed.requests[0].resolve(clip()); await Promise.all([beforeLoad, resumeBeforeLoad]);
  equal(resumed.audios[0].plays, 1, 'A pending resume starts exactly one playback');
  resumed.controller.dispose();

  const stopped = harness();
  const stoppedLoad = stopped.controller.play(slides, 0);
  const signal = stopped.requests[0].init.signal;
  stopped.controller.stop();
  equal(signal.aborted, true, 'Stop aborts the in-flight synthesis request');
  stopped.requests[0].resolve(clip()); await stoppedLoad;
  equal(stopped.audios.length, 0, 'A stopped late response cannot create or play audio');
  equal(stopped.created.length, 0, 'A stopped response does not leak an object URL');
  stopped.controller.dispose();

  const interrupted = harness();
  let resolvePlay;
  interrupted.setPlay(() => new Promise(resolve => { resolvePlay = resolve; }));
  const interruptedPlay = interrupted.controller.play(slides, 0);
  interrupted.requests[0].resolve(clip()); await settle();
  interrupted.controller.pause(); resolvePlay(); await interruptedPlay;
  equal(interrupted.states.at(-1), 'paused', 'A delayed play promise cannot undo a pause');
  check(interrupted.audios[0].pauses >= 2, 'Paused audio is stopped again if a pending play resolves');
  interrupted.controller.dispose();

  const denied = harness();
  denied.setPlay(() => Promise.reject(new DOMException('Gesture required', 'NotAllowedError')));
  const deniedPlay = denied.controller.play(slides, 0);
  denied.requests[0].resolve(clip()); await deniedPlay;
  check(denied.notices.at(-1).includes('Press Play again'), 'Autoplay rejection asks for an explicit retry');
  equal(denied.states.at(-1), 'idle', 'Autoplay rejection does not pretend to be playing');
  denied.setPlay(() => Promise.resolve());
  await denied.controller.play(slides, 0);
  equal(denied.requests.length, 2, 'An autoplay retry reuses the generated clip and prepares the next frame');
  equal(denied.states.at(-1), 'playing', 'A permitted retry starts playback');
  denied.controller.dispose();

  const failed = harness();
  const failure = failed.controller.play(slides, 0);
  failed.requests[0].resolve(Response.json({ error: { message: 'Amanda is not connected yet.' } }, { status: 503 }));
  await failure;
  equal(failed.states.at(-1), 'idle', 'A synthesis failure returns to idle');
  equal(failed.notices.at(-1), 'Amanda is not connected yet.', 'Safe service setup guidance reaches the learner');
  equal(failed.audios.length, 0, 'A failed cloud request never falls back to browser speech');
  failed.controller.dispose();

  const broken = harness();
  const brokenPlay = broken.controller.play(slides, 0);
  broken.requests[0].resolve(clip()); await brokenPlay;
  const brokenEnd = broken.audios[0].onended;
  broken.audios[0].onerror();
  equal(broken.revoked.length, 1, 'Unreadable audio is evicted so a retry can request fresh bytes');
  brokenEnd(); equal(broken.indices, [], 'A failed clip’s stale completion cannot advance the lesson');
  const retryBroken = broken.controller.play(slides, 0);
  equal(broken.requests.length, 3, 'Retrying a decode error generates fresh audio instead of sharing its canceled lookahead');
  broken.requests[2].resolve(clip()); await retryBroken;
  broken.controller.dispose();

  const disposed = harness();
  const late = disposed.controller.play(slides, 0);
  disposed.controller.dispose(); const callbacksAfterDisposal = disposed.states.length;
  disposed.requests[0].resolve(clip()); await late;
  equal(disposed.states.length, callbacksAfterDisposal, 'Disposed controllers never update mounted UI state later');
  equal(disposed.audios.length, 0, 'Unmounting during generation prevents late playback');

  const cached = harness();
  for (let index = 0; index < 10; index++) {
    const work = cached.controller.play([{ narration: `Distinct clip ${index}` }], 0);
    cached.requests[index].resolve(clip()); await work;
  }
  equal(cached.revoked.length, 2, 'Only eight clip URLs remain cached per lesson');
  cached.controller.dispose();
  equal(cached.revoked.length, 10, 'Eviction and disposal release all generated URLs exactly once');

  const prepared = harness();
  const threeFrames = [...slides, { narration: 'Third animated teaching frame.' }];
  const preparedPlay = prepared.controller.play(threeFrames, 0);
  equal(prepared.requests.length, 1, 'Lookahead waits until the active frame has actually started playing');
  prepared.requests[0].resolve(clip()); await preparedPlay;
  equal(prepared.requests.length, 2, 'Playing a frame prepares only its immediate successor');
  equal(JSON.parse(prepared.requests[1].init.body).text, slides[1].narration, 'Lookahead synthesizes the next spoken frame');
  prepared.requests[1].resolve(clip()); await settle();
  equal(prepared.indices, [], 'Prepared narration never advances the teaching visual ahead of the active voice');
  equal(prepared.audios.length, 1, 'Lookahead does not create a second playback element');
  equal(prepared.requests.length, 2, 'Completing a lookahead does not recursively fetch the whole lesson');
  prepared.audios[0].onended(); await settle();
  equal(prepared.indices, [1], 'The prepared visual advances exactly when its preceding frame ends');
  equal(prepared.audios.length, 2, 'A prepared frame can begin without another synthesis request');
  equal(prepared.audios[1].src, prepared.created[1].url, 'The next frame plays its prefetched clip');
  equal(prepared.requests.length, 3, 'Only after advancing does preparation move one frame forward');
  const preparedSignal = prepared.requests[2].init.signal;
  prepared.controller.dispose();
  equal(preparedSignal.aborted, true, 'Disposal aborts an in-flight lookahead as well as foreground requests');
  prepared.requests[2].resolve(clip()); await settle();
  equal(prepared.created.length, 2, 'A disposed lookahead cannot create a late object URL');
  equal(prepared.revoked.length, 2, 'Disposal releases foreground and prefetched clips exactly once');

  const canceledAhead = harness();
  const canceledAheadPlay = canceledAhead.controller.play(slides, 0);
  canceledAhead.requests[0].resolve(clip()); await canceledAheadPlay;
  const aheadSignal = canceledAhead.requests[1].init.signal;
  canceledAhead.controller.stop();
  equal(aheadSignal.aborted, true, 'Stopping active narration aborts its pending lookahead');
  const replacement = canceledAhead.controller.play([{ narration: 'Another teaching scene.' }], 0);
  canceledAhead.requests[1].resolve(clip());
  canceledAhead.requests[2].resolve(clip()); await replacement; await settle();
  equal(canceledAhead.created.length, 2, 'An old lookahead cannot populate the new playlist cache after navigation');
  equal(canceledAhead.indices, [], 'Late preparation cannot change the selected teaching frame');
  equal(canceledAhead.audios.length, 2, 'Only the new playlist starts after navigation');
  canceledAhead.controller.dispose();

  const failedAhead = harness();
  const failedAheadPlay = failedAhead.controller.play(slides, 0);
  failedAhead.requests[0].resolve(clip()); await failedAheadPlay;
  failedAhead.requests[1].resolve(Response.json({ error: { message: 'Temporary preparation failure.' } }, { status: 503 }));
  await settle();
  equal(failedAhead.states.at(-1), 'playing', 'A failed lookahead never interrupts the current frame');
  equal(failedAhead.notices.at(-1), '', 'Lookahead failure does not show an error for audio that is still playing');
  failedAhead.audios[0].onended(); await settle();
  equal(failedAhead.requests.length, 3, 'A failed prepared frame receives a fresh foreground request when reached');
  failedAhead.requests[2].resolve(clip()); await settle();
  equal(failedAhead.states.at(-1), 'playing', 'The learner can continue after a transient lookahead failure');
  failedAhead.controller.dispose();
  console.log(`PASS ${assertions} neural narration assertions: playback, pause/resume, synchronized frame changes, one-frame lookahead, cancellation, retries, and bounded clip cleanup.`);
}
journeys().catch(error => { console.error(error); process.exitCode = 1; });
