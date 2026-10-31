/* eslint-disable @typescript-eslint/no-require-imports */
/** Offline UI regressions using actual component handlers and stubbed browser APIs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };

function load(relative, overrides = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireLocal = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('@/')) {
      const target = ['.ts', '.tsx'].map(extension => name.slice(2) + extension).find(file => fs.existsSync(path.join(root, file)));
      return load(target, overrides, cache);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', code)(requireLocal, item, item.exports);
  return item.exports;
}
function hooks() {
  const slots = []; let index = 0, effects = [];
  return {
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
      },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useCallback(callback, dependencies) {
        const slot = index++, previous = slots[slot];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
          slots[slot] = { callback, dependencies };
        }
        return slots[slot].callback;
      },
      useMemo(factory, dependencies) {
        const slot = index++, previous = slots[slot];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
          slots[slot] = { value: factory(), dependencies };
        }
        return slots[slot].value;
      },
      useEffect(effect, dependencies) {
        const slot = index++, previous = slots[slot];
        if (!previous || !dependencies || dependencies.some((value, i) => value !== previous.dependencies[i])) {
          effects.push(() => { previous?.cleanup?.(); slots[slot] = { dependencies, cleanup: effect() }; });
        }
      },
    },
    render(component) { index = 0; const tree = component(); const pending = effects; effects = []; pending.forEach(run => run()); return tree; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, predicate) => nodes(tree).find(predicate);
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
const button = (tree, label) => find(tree, node => node.type === 'button' && (node.props['aria-label'] === label || text(node).trim() === label));
const componentOverrides = state => ({ react: state.react, 'react/jsx-runtime': jsx, '@/components/icon': { Icon: () => null }, 'next/link': 'a' });
const lesson = {
  id: 'journey-lesson', moduleId: 'journey-module', title: 'Retention analysis',
  slides: [
    { id: 'slide-one', title: 'Foundations', bullets: ['Use a consistent denominator.'], narration: 'Eight retained customers divided by ten total customers gives 80 percent.' },
    { id: 'slide-two', title: 'Worked example', bullets: ['Compare matching time windows.'], narration: 'Use the same observation window when comparing retention across cohorts.' },
  ],
  quiz: Array.from({ length: 5 }, (_, index) => ({ id: `quiz-${index}`, question: `Retention check ${index + 1}?`, options: ['Use matching counts', 'Ignore the denominator', 'Ignore dates', 'Assume 100 percent'], correctAnswer: 0, explanation: `Check ${index + 1}: match the denominator and observation period.` })),
};

async function narrationJourney() {
  const spoken = []; let pauses = 0, resumes = 0, cancellations = 0, slideIndex = 0;
  let speechPaused = false;
  const windowEvents = new Map(), documentEvents = new Map(), voiceEvents = new Map(), preferences = new Map([['ownpath:narration-source:v1', 'browser']]);
  global.fetch = async () => Response.json({ available: false, voiceId: 'en-US-AmandaMultilingualNeural' });
  const samantha = { name: 'Samantha', voiceURI: 'samantha-enhanced', lang: 'en-US', default: false, localService: true };
  const karen = { name: 'Karen', voiceURI: 'karen', lang: 'en-AU', default: false, localService: true };
  let availableVoices = [];
  global.window = {
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    removeEventListener: name => windowEvents.delete(name),
    localStorage: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
    speechSynthesis: {
      speak: utterance => spoken.push(utterance),
      get paused() { return speechPaused; },
      pause: () => { pauses++; speechPaused = true; },
      resume: () => { resumes++; speechPaused = false; },
      cancel: () => cancellations++,
      getVoices: () => availableVoices,
      addEventListener: (name, callback) => voiceEvents.set(name, callback),
      removeEventListener: name => voiceEvents.delete(name),
    },
    SpeechSynthesisUtterance: class { constructor(value) { this.text = value; } },
  };
  global.document = {
    hidden: false,
    addEventListener: (name, callback) => documentEvents.set(name, callback),
    removeEventListener: name => documentEvents.delete(name),
  };
  global.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance;
  const state = hooks(), pauseNarrationRef = { current: null };
  const { LecturePlayer } = load('components/lecture-player.tsx', componentOverrides(state));
  const render = () => state.render(() => LecturePlayer({ lesson, slideIndex, onSlideChange: value => { slideIndex = value; }, pauseNarrationRef }));
  let tree = render();
  await Promise.resolve(); tree = render();
  check(find(tree, node => node.props?.['aria-label'] === 'Narration voice'), 'The source selector remains available while browser voices load');
  availableVoices = [{ name: 'Fred', voiceURI: 'fred', lang: 'en-US', default: true, localService: true }, karen, samantha];
  voiceEvents.get('voiceschanged')(); tree = render();
  button(tree, 'Play narration').props.onClick(); tree = render();
  equal(spoken.length, 1, 'Play creates one utterance');
  equal(spoken[0].voice, samantha, 'Playback uses the recommended clear voice after voices load asynchronously');
  equal(spoken[0].lang, 'en-US', 'Narration uses the selected voice’s language');
  pauseNarrationRef.current(); tree = render();
  check(pauses === 1 && button(tree, 'Resume narration'), 'Tutor interaction pauses with a resumable utterance');
  button(tree, 'Resume narration').props.onClick(); tree = render();
  check(resumes === 1 && spoken.length === 1, 'Resume does not restart the lecture');
  document.hidden = true; documentEvents.get('visibilitychange')(); tree = render();
  check(pauses === 2 && button(tree, 'Resume narration'), 'Hiding the page pauses narration without resetting it');
  document.hidden = false; button(tree, 'Resume narration').props.onClick(); tree = render();
  button(tree, 'Next').props.onClick(); tree = render();
  check(slideIndex === 1 && button(tree, 'Play narration'), 'Navigation changes slide and stops speech');
  spoken[0].onend(); equal(slideIndex, 1, 'Cancelled speech callback cannot advance a later slide');
  button(tree, 'Play narration').props.onClick(); tree = render();
  windowEvents.get('pagehide')(); tree = render();
  check(button(tree, 'Play narration'), 'Page exit stops narration');
  find(tree, node => node.props?.['aria-label'] === 'Narration voice').props.onChange({ target: { value: `browser:${karen.voiceURI}` } });
  tree = render(); button(tree, 'Play narration').props.onClick(); tree = render();
  equal(spoken.at(-1).voice, karen, 'The learner’s selected voice is used for playback');
  equal(preferences.get('ownpath:narration-voice:v1'), karen.voiceURI, 'The voice preference is saved independently of learning progress');
  find(tree, node => node.props?.['aria-label'] === 'Narration voice').props.onChange({ target: { value: 'browser' } }); tree = render();
  check(button(tree, 'Play narration'), 'Changing voices stops the current narration');
  equal(preferences.has('ownpath:narration-voice:v1'), false, 'Choosing Recommended removes a saved override');
  const before = cancellations; state.unmount();
  check(cancellations > before && pauseNarrationRef.current === null, 'Leaving the lesson cancels speech and clears its controller');
  equal(voiceEvents.size, 0, 'Leaving the lesson removes its voice-list subscription');

  preferences.set('ownpath:narration-voice:v1', karen.voiceURI);
  const restored = hooks();
  const { LecturePlayer: RestoredPlayer } = load('components/lecture-player.tsx', componentOverrides(restored));
  const renderRestored = () => restored.render(() => RestoredPlayer({ lesson, slideIndex: 0, onSlideChange() {}, pauseNarrationRef: { current: null } }));
  renderRestored(); await Promise.resolve(); let restoredTree = renderRestored();
  equal(find(restoredTree, node => node.props?.['aria-label'] === 'Narration voice').props.value, `browser:${karen.voiceURI}`, 'A saved voice choice is restored on another visit');
  window.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
  find(restoredTree, node => node.props?.['aria-label'] === 'Narration voice').props.onChange({ target: { value: `browser:${samantha.voiceURI}` } });
  restoredTree = renderRestored(); button(restoredTree, 'Play narration').props.onClick();
  equal(spoken.at(-1).voice, samantha, 'Voice selection still works when browser storage rejects a write');
  restored.unmount();
  delete window.speechSynthesis;
  const unsupported = hooks();
  const { LecturePlayer: WithoutSpeech } = load('components/lecture-player.tsx', componentOverrides(unsupported));
  const renderUnsupported = () => unsupported.render(() => WithoutSpeech({ lesson, slideIndex: 0, onSlideChange() {}, pauseNarrationRef: { current: null } }));
  renderUnsupported(); await Promise.resolve(); let fallback = renderUnsupported();
  button(fallback, 'Play narration').props.onClick(); fallback = renderUnsupported();
  check(text(fallback).includes('does not support narration'), 'Unsupported speech offers transcript guidance');
  unsupported.unmount();
}

async function cloudNarrationJourney() {
  const requests = [], audio = [], windowEvents = new Map(), documentEvents = new Map();
  global.window = {
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    removeEventListener: name => windowEvents.delete(name),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  global.document = { hidden: false, addEventListener: (name, callback) => documentEvents.set(name, callback), removeEventListener: name => documentEvents.delete(name) };
  global.Audio = class {
    constructor() { audio.push(this); this.currentTime = 0; }
    async play() {}
    pause() {}
    removeAttribute() {}
    load() {}
  };
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    return init?.method === 'POST'
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } })
      : Response.json({ available: true, voiceId: 'en-US-AmandaMultilingualNeural' });
  };
  const state = hooks(), pauseNarrationRef = { current: null }; let slideIndex = 0;
  const { LecturePlayer } = load('components/lecture-player.tsx', componentOverrides(state));
  const render = () => state.render(() => LecturePlayer({ lesson, slideIndex, onSlideChange: index => { slideIndex = index; }, pauseNarrationRef }));
  const settle = () => new Promise(setImmediate);
  render(); await settle(); let tree = render();
  equal(find(tree, node => node.props?.['aria-label'] === 'Narration voice').props.value, 'amanda', 'Amanda is the default without a stored browser override');
  equal(button(tree, 'Play narration').props.disabled, false, 'Configured Amanda works without browser speech synthesis');
  button(tree, 'Play narration').props.onClick(); await settle(); tree = render();
  check(button(tree, 'Pause narration'), 'The cloud player reaches active playback');
  equal(JSON.parse(requests.find(request => request.init?.method === 'POST').init.body), { text: lesson.slides[0].narration }, 'Only the current slide narration is sent for speech');
  pauseNarrationRef.current(); tree = render();
  check(button(tree, 'Resume narration'), 'Tutor interaction pauses Amanda');
  button(tree, 'Resume narration').props.onClick(); await settle(); tree = render();
  equal(requests.filter(request => request.init?.method === 'POST').length, 2, 'Cloud resume shares the active clip and its one-frame lookahead');
  find(tree, node => node.type === 'select' && !node.props['aria-label']).props.onChange({ target: { value: '1.25' } }); tree = render();
  equal(audio.at(-1).playbackRate, 1.25, 'Cloud speed changes apply to the current audio');
  audio.at(-1).onended(); await settle(); tree = render();
  equal(slideIndex, 1, 'Amanda advances to the next slide when its audio ends');
  equal(audio.at(-1).playbackRate, 1.25, 'Cloud speed carries over to the next slide');
  document.hidden = true; documentEvents.get('visibilitychange')(); tree = render();
  check(button(tree, 'Resume narration'), 'Hiding the page pauses Amanda');
  document.hidden = false; button(tree, 'Resume narration').props.onClick(); await settle(); tree = render();
  const staleEnd = audio.at(-1).onended;
  windowEvents.get('pagehide')(); tree = render(); staleEnd();
  check(button(tree, 'Play narration') && slideIndex === 1, 'Page exit stops cloud audio and invalidates its end callback');
  state.unmount();
  equal(pauseNarrationRef.current, null, 'Cloud cleanup releases the tutor pause callback');

  global.fetch = async () => Response.json({ available: false, voiceId: 'en-US-AmandaMultilingualNeural' });
  const offline = hooks();
  const { LecturePlayer: OfflinePlayer } = load('components/lecture-player.tsx', componentOverrides(offline));
  const renderOffline = () => offline.render(() => OfflinePlayer({ lesson, slideIndex: 0, onSlideChange() {}, pauseNarrationRef: { current: null } }));
  renderOffline(); await settle(); const offlineTree = renderOffline();
  check(button(offlineTree, 'Play narration').props.disabled && text(offlineTree).includes('waiting for setup'), 'Missing speech credentials are visible without silently using a browser voice');
  offline.unmount();
}

const animationLesson = {
  ...lesson,
  id: 'animated-retention-lesson',
  slides: [
    {
      id: 'animated-counts', title: 'Build the retention calculation', bullets: ['Count retained and eligible customers.', 'Divide using the same observation window.'],
      scenes: [
        {
          title: 'Keep both counts visible',
          narration: 'Start with the same ten eligible customers and count which eight returned during the observation window, rather than mixing records from different periods. Keep the eligible count of ten beside the retained count of eight so the denominator remains visible while we work through the calculation.',
          visual: { kind: 'code', lines: ['eligible = 10', 'retained = 8'] },
        },
        {
          title: 'Calculate the share', narration: 'Divide eight by ten to get 0.8, or eighty percent.',
          visual: { kind: 'calculation', lines: ['8 ÷ 10 = 0.8', '0.8 × 100 = 80%'] },
        },
      ],
      narration: '',
    },
    {
      id: 'animated-compare', title: 'Compare matching windows', bullets: ['Keep the observation window the same.'],
      scenes: [{ title: 'Make a fair comparison', narration: 'Compare cohorts over the same thirty-day window.', visual: { kind: 'comparison', lines: ['Cohort A: 30 days', 'Cohort B: 30 days'] } }],
      narration: '',
    },
  ],
};
animationLesson.slides.forEach(slide => { slide.narration = slide.scenes.map(scene => scene.narration).join(' '); });
const animationFrames = load('lib/teaching-scenes.ts').createTeachingFrames(animationLesson.slides);

async function animationHarness(source) {
  const spoken = [], audios = [], requests = [], preferences = new Map([['ownpath:narration-source:v1', source]]);
  const speechState = { paused: false, queued: [], started: [] };
  const counts = { pauses: 0, resumes: 0, cancellations: 0 };
  let slideIndex = 0, activeLesson = animationLesson;
  global.window = {
    addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
    speechSynthesis: {
      speak: utterance => {
        spoken.push(utterance);
        speechState.queued.push(utterance);
        if (!speechState.paused) speechState.started.push(utterance);
      },
      get paused() { return speechState.paused; },
      pause: () => { counts.pauses++; speechState.paused = true; },
      resume: () => {
        counts.resumes++; speechState.paused = false;
        for (const utterance of speechState.queued)
          if (!speechState.started.includes(utterance)) speechState.started.push(utterance);
      },
      // Per Web Speech API, cancel empties the queue without changing paused.
      cancel: () => { counts.cancellations++; speechState.queued = []; },
      getVoices: () => [], addEventListener() {}, removeEventListener() {},
    },
    SpeechSynthesisUtterance: class { constructor(value) { this.text = value; } },
  };
  global.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance;
  global.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  global.Audio = class {
    constructor() { this.currentTime = 0; this.pauses = 0; audios.push(this); }
    async play() {}
    pause() { this.pauses++; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  };
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    return init?.method === 'POST'
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } })
      : Response.json({ available: true, voiceId: 'en-US-AmandaMultilingualNeural' });
  };
  const state = hooks(), pauseNarrationRef = { current: null };
  const { LecturePlayer } = load('components/lecture-player.tsx', componentOverrides(state));
  let tree;
  const render = () => { tree = state.render(() => LecturePlayer({ lesson: activeLesson, slideIndex, onSlideChange: index => { slideIndex = index; }, pauseNarrationRef })); return tree; };
  const caption = () => text(find(find(tree, node => node.props?.className === 'teaching-caption'), node => node.type === 'p'));
  const visual = () => find(tree, node => node.props?.className?.startsWith('teaching-visual teaching-visual-'));
  const settle = async () => { await new Promise(setImmediate); render(); };
  render(); await settle();
  return {
    spoken, audios, requests, counts, speechState, pauseNarrationRef, render, caption, visual, settle,
    setSlideIndex(index) { slideIndex = index; return render(); },
    updateLesson(next) { activeLesson = next; return render(); },
    unmount: () => state.unmount(), get tree() { return tree; }, get slideIndex() { return slideIndex; },
  };
}

async function animatedNarrationJourney() {
  equal(animationFrames.length, 4, 'Detailed teaching scenes yield separate spoken beats within the first slide');
  const native = await animationHarness('browser');
  equal(native.caption(), animationFrames[0].narration, 'The opening caption contains exactly the first spoken beat');
  check(text(native.visual()).includes('eligible = 10'), 'The first scene displays its concrete code example');
  button(native.tree, 'Play narration').props.onClick(); native.render();
  equal(native.spoken[0].text, native.caption(), 'Browser narration reads the visible caption rather than the full static slide');
  native.pauseNarrationRef.current(); native.render();
  const pausedCaption = native.caption();
  button(native.tree, 'Resume narration').props.onClick(); native.render();
  equal(native.caption(), pausedCaption, 'Pausing and resuming keeps the same explanation on screen');
  equal(native.spoken.length, 1, 'Resuming a teaching beat does not synthesize a replacement utterance');
  native.spoken[0].onend(); native.render();
  equal(native.slideIndex, 0, 'The first beat advances within the current slide');
  equal(native.spoken[1].text, animationFrames[1].narration, 'The next utterance is the next teaching beat');
  equal(native.caption(), native.spoken[1].text, 'The visible caption follows the new utterance exactly');
  check(nodes(native.visual()).some(node => node.props?.className?.includes('is-active') && text(node).includes('retained = 8')), 'The visual emphasizes the next calculation input as narration advances');
  native.spoken[1].onend(); native.render();
  equal(native.slideIndex, 0, 'A different scene can begin without leaving its teaching slide');
  check(native.visual().props.className.includes('calculation'), 'Finishing a scene changes the stage from code to its calculation');
  equal(native.caption(), animationFrames[2].narration, 'The worked result appears with the matching spoken explanation');
  native.spoken[2].onend(); native.render();
  equal(native.slideIndex, 1, 'Finishing all explanations advances to the following slide');
  check(native.visual().props.className.includes('comparison'), 'The next slide displays its own comparison scene');
  equal(native.caption(), native.spoken[3].text, 'A slide transition preserves speech and caption alignment');
  native.spoken[3].onend(); native.render();
  check(button(native.tree, 'Play narration') && text(native.tree).includes('reached the end'), 'The final teaching beat completes narration');

  button(native.tree, 'Previous').props.onClick(); native.render();
  equal(native.caption(), animationFrames[0].narration, 'Manual slide navigation returns to that slide’s first explanation');
  button(native.tree, 'Play narration').props.onClick(); native.render();
  const staleNative = native.spoken.at(-1), beforeManual = native.counts.cancellations;
  button(native.tree, 'Next explanation').props.onClick(); native.render();
  check(native.counts.cancellations > beforeManual && button(native.tree, 'Play narration'), 'Manual next explanation cancels narration and leaves the new beat ready');
  equal(native.caption(), animationFrames[1].narration, 'Manual next selects one explanation rather than skipping the whole slide');
  staleNative.onend(); native.render();
  equal(native.caption(), animationFrames[1].narration, 'Canceled native speech cannot move the new explanation');
  button(native.tree, 'Previous explanation').props.onClick(); native.render();
  equal(native.caption(), animationFrames[0].narration, 'Manual previous returns to the earlier explanation');
  button(native.tree, 'Go to step 2: Calculate the share').props.onClick(); native.render();
  equal(native.caption(), animationFrames[2].narration, 'Step navigation selects the corresponding scene’s first beat');
  button(native.tree, 'Play narration').props.onClick(); native.render();
  const beforeSpeed = native.counts.cancellations;
  find(native.tree, node => node.type === 'select' && !node.props['aria-label']).props.onChange({ target: { value: '1.25' } }); native.render();
  check(native.counts.cancellations > beforeSpeed && button(native.tree, 'Play narration'), 'Changing native narration speed stops the old utterance');
  button(native.tree, 'Play narration').props.onClick(); native.render();
  equal(native.spoken.at(-1).rate, 1.25, 'The selected speed applies when the current explanation restarts');
  const priorSourceUtterance = native.spoken.at(-1), priorCaption = native.caption();
  find(native.tree, node => node.props?.['aria-label'] === 'Narration voice').props.onChange({ target: { value: 'amanda' } }); native.render();
  priorSourceUtterance.onend(); native.render();
  equal(native.caption(), priorCaption, 'Changing narration source cancels old callbacks without changing the selected explanation');
  check(button(native.tree, 'Play narration'), 'Changing source leaves narration stopped');
  native.unmount();

  const cloud = await animationHarness('amanda');
  button(cloud.tree, 'Play narration').props.onClick(); await cloud.settle();
  const firstPosts = cloud.requests.filter(request => request.init?.method === 'POST');
  equal(JSON.parse(firstPosts[0].init.body).text, cloud.caption(), 'Amanda receives precisely the opening caption text');
  equal(firstPosts.length, 2, 'Amanda prepares the next beat while speaking the current one');
  equal(cloud.caption(), animationFrames[0].narration, 'Prefetch does not change the visible explanation early');
  cloud.audios[0].currentTime = 2.5;
  cloud.pauseNarrationRef.current(); cloud.render();
  button(cloud.tree, 'Resume narration').props.onClick(); await cloud.settle();
  equal(cloud.audios[0].currentTime, 2.5, 'Cloud resume preserves the current explanation’s audio position');
  cloud.audios[0].onended(); await cloud.settle();
  equal(cloud.slideIndex, 0, 'Amanda advances to a new beat inside the current slide');
  equal(cloud.caption(), animationFrames[1].narration, 'Amanda’s next audio and visible caption use the same teaching beat');
  const staleCloud = cloud.audios.at(-1).onended;
  const cloudAudio = cloud.audios.at(-1);
  button(cloud.tree, 'Next explanation').props.onClick(); cloud.render();
  check(cloudAudio.pauses > 0 && button(cloud.tree, 'Play narration'), 'Manual next explanation stops Amanda before moving the stage');
  equal(cloud.caption(), animationFrames[2].narration, 'Cloud manual controls reach the next scene');
  staleCloud(); await cloud.settle();
  equal(cloud.caption(), animationFrames[2].narration, 'A canceled cloud callback cannot skip the manual scene selection');
  cloud.unmount();

  for (const source of ['browser', 'amanda']) {
    const external = await animationHarness(source);
    button(external.tree, 'Play narration').props.onClick(); await external.settle();
    const oldEnd = source === 'browser' ? external.spoken.at(-1).onend : external.audios.at(-1).onended;
    external.pauseNarrationRef.current(); external.render();
    check(button(external.tree, 'Resume narration'), `${source}: the source chapter is paused before a review link changes it`);
    external.setSlideIndex(1); await external.settle();
    equal(external.caption(), animationFrames[3].narration, `${source}: external chapter navigation immediately displays the destination explanation`);
    check(button(external.tree, 'Play narration'), `${source}: an external chapter change clears the resumable source audio`);
    button(external.tree, 'Play narration').props.onClick(); await external.settle();
    const spokenText = source === 'browser' ? external.spoken.at(-1).text
      : JSON.parse(external.requests.filter(request => request.init?.method === 'POST').at(-1).init.body).text;
    equal(spokenText, animationFrames[3].narration, `${source}: Play starts the destination chapter instead of resuming the previous one`);
    oldEnd(); await external.settle();
    equal(external.caption(), animationFrames[3].narration, `${source}: a paused source chapter's stale callback cannot move the destination`);

    const beforeUpdateEnd = source === 'browser' ? external.spoken.at(-1).onend : external.audios.at(-1).onended;
    const expandedNarration = 'Use a matching thirty-day observation window for both cohorts before comparing their retained shares.';
    const updated = {
      ...animationLesson,
      slides: animationLesson.slides.map((slide, index) => index === 1 ? {
        ...slide, narration: expandedNarration,
        scenes: [{ title: 'Inspect the matching windows', narration: expandedNarration, visual: { kind: 'comparison', lines: ['Cohort A: matching 30-day window', 'Cohort B: matching 30-day window'] } }],
      } : slide),
    };
    external.updateLesson(updated); await external.settle();
    equal(external.caption(), expandedNarration, `${source}: teaching updates under the same lesson ID replace the visible explanation`);
    check(button(external.tree, 'Play narration'), `${source}: teaching updates stop the previous narration session`);
    beforeUpdateEnd(); await external.settle();
    equal(external.caption(), expandedNarration, `${source}: old teaching audio cannot advance the updated lesson`);
    button(external.tree, 'Play narration').props.onClick(); await external.settle();
    const updatedSpokenText = source === 'browser' ? external.spoken.at(-1).text
      : JSON.parse(external.requests.filter(request => request.init?.method === 'POST').at(-1).init.body).text;
    equal(updatedSpokenText, expandedNarration, `${source}: Play uses the updated teaching text rather than a stale cached sequence`);
    external.unmount();
  }

  const restartActions = [
    ['Stop', player => button(player.tree, 'Stop narration').props.onClick()],
    ['manual explanation navigation', player => button(player.tree, 'Next explanation').props.onClick()],
    ['speed change', player => find(player.tree, node => node.type === 'select' && !node.props['aria-label']).props.onChange({ target: { value: '1.25' } })],
    ['external chapter navigation', player => player.setSlideIndex(1)],
    ['voice change', player => find(player.tree, node => node.props?.['aria-label'] === 'Narration voice').props.onChange({ target: { value: 'browser' } })],
  ];
  for (const [action, change] of restartActions) {
    const restarting = await animationHarness('browser');
    button(restarting.tree, 'Play narration').props.onClick(); await restarting.settle();
    restarting.pauseNarrationRef.current(); restarting.render();
    check(restarting.speechState.paused, `${action}: browser synthesis enters its global paused state`);
    change(restarting); await restarting.settle();
    check(restarting.speechState.paused && button(restarting.tree, 'Play narration'), `${action}: cancel clears the utterance while preserving global pause`);
    button(restarting.tree, 'Play narration').props.onClick(); await restarting.settle();
    check(!restarting.speechState.paused, `${action}: fresh playback resumes the global synthesizer`);
    equal(restarting.speechState.started.at(-1), restarting.spoken.at(-1), `${action}: the new utterance actually starts instead of waiting silently in the queue`);
    equal(restarting.speechState.started.at(-1).text, restarting.caption(), `${action}: restarted speech matches the visible explanation`);
    restarting.unmount();
  }
}

async function tutorJourney() {
  const state = hooks(), requests = [], reviewQuestionRef = { current: null }; let fail = false, interactions = 0;
  const { LectureChat } = load('components/lecture-chat.tsx', {
    ...componentOverrides(state),
    '@/lib/api-client': { requestTutorResponse: async (supplied, question, messages) => {
      requests.push({ supplied, question, messages });
      if (fail) throw new Error('Temporary connection failure. Try again.');
      return { mode: 'claude', message: { id: `answer-${requests.length}`, role: 'assistant', content: 'Use matching denominators in that example.' } };
    } },
  });
  const render = () => state.render(() => LectureChat({ lesson, slideIndex: 0, onInteract: () => interactions++, reviewQuestionRef }));
  let tree = render();
  const type = value => { find(tree, node => node.type === 'textarea').props.onChange({ target: { value } }); tree = render(); };
  const send = async () => { find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await new Promise(setImmediate); tree = render(); };
  find(tree, node => node.type === 'textarea').props.onFocus(); equal(interactions, 1, 'Question focus pauses narration');
  type('Explain this example'); await send(); type('Why use that denominator?'); await send();
  equal(requests[1].messages.length, 2, 'Second question retains both sides of first turn');
  check(requests[1].messages[0].content.includes('slide-one'), 'Conversation keeps the earlier slide context');
  check(!text(tree).includes('[OwnPath slide:'), 'Technical context prefix is hidden from the conversation');
  check(text(tree).includes('CLAUDE'), 'Tutor displays actual provider mode');
  fail = true; type('Show another example'); await send();
  check(text(tree).includes('Explain this example') && text(tree).includes('Why use that denominator?'), 'A failed request preserves the conversation');
  equal(find(tree, node => node.type === 'textarea').props.value, 'Show another example', 'Failed question remains available');
  fail = false; button(tree, 'Try again').props.onClick(); await new Promise(setImmediate); tree = render();
  equal(requests.at(-1).messages.length, 4, 'Retry excludes the failed turn and retains successful history');
  equal(requests.at(-1).question, '[OwnPath slide: slide-one]\nShow another example', 'Retry retains original slide and question');
  check(typeof reviewQuestionRef.current === 'function', 'Quiz can direct a question into the existing tutor');
  reviewQuestionRef.current('Help me review the missed denominator question.'); tree = render();
  equal(find(tree, node => node.type === 'textarea').props.value, 'Help me review the missed denominator question.', 'Review prompt is editable before sending');
  equal(requests.length, 4, 'Review guidance does not send an unsolicited provider request');
  const before = requests.length, form = find(tree, node => node.type === 'form');
  form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); await new Promise(setImmediate); tree = render();
  equal(requests.length, before + 1, 'Double submission sends only one request');
  state.unmount();
}

function assessmentJourney() {
  let state = hooks(), retryRequested = false;
  const attempts = [], reviewPrompts = [];
  let { Quiz } = load('components/quiz.tsx', componentOverrides(state));
  const props = { lesson, onComplete: result => attempts.push(result), onReview: question => reviewPrompts.push(question), onRetry: () => { retryRequested = true; } };
  const render = () => state.render(() => Quiz(props)); let tree = render();
  function answerAll(index) {
    for (const question of props.lesson.quiz) {
      find(tree, node => node.type === 'input' && node.props.name === question.id && Number(node.props.value) === index).props.onChange(); tree = render();
    }
  }
  answerAll(1); find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); tree = render();
  equal(attempts[0].score, 0, 'Incorrect choices fail with the correct score');
  check(text(tree).includes('Focus your next review'), 'Failure provides targeted review guidance');
  check(text(tree).includes(lesson.quiz[0].explanation), 'Failure explains the actual missed question');
  button(tree, 'Review this question with tutor').props.onClick();
  check(reviewPrompts[0].includes(lesson.quiz[0].question) && reviewPrompts[0].includes(lesson.quiz[0].explanation), 'Review action carries the specific missed question and reasoning');
  button(tree, 'Practice again').props.onClick();
  check(retryRequested, 'Retry requests fresh questions from the parent');
  state.unmount(); state = hooks();
  ({ Quiz } = load('components/quiz.tsx', componentOverrides(state)));
  props.lesson = { ...lesson, quiz: lesson.quiz.map((question, index) => ({ ...question, id: `retake-${index}`, question: `Fresh retention scenario ${index + 1}?` })) };
  tree = render();
  check(nodes(tree).filter(node => node.type === 'input').every(node => !node.props.checked), 'Retry clears old answers');
  answerAll(0); find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); tree = render();
  check(attempts[1].passed && attempts[1].score === 100, 'Retry can pass after reviewing mistakes');
  const saved = hooks();
  const { Quiz: RestoredQuiz } = load('components/quiz.tsx', componentOverrides(saved));
  const restored = saved.render(() => RestoredQuiz({ ...props, previousResult: attempts[0] }));
  check(text(restored).includes('Your saved score is') && text(restored).includes('0'), 'A failed saved result remains visible after remount');
}

async function networkFailures() {
  const client = load('lib/api-client.ts');
  global.fetch = async () => { throw new TypeError('Network failure'); };
  await assert.rejects(() => client.requestTutorResponse(lesson, 'Explain?', []), /Could not reach OwnPath/); assertions++;
  global.fetch = async () => new Response('Malformed gateway body');
  await assert.rejects(() => client.requestTutorResponse(lesson, 'Explain?', []), /unreadable response/); assertions++;
  global.fetch = async () => Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Check the server API key and try again.' } }, { status: 500 });
  await assert.rejects(() => client.requestTutorResponse(lesson, 'Explain?', []), /Check the server API key/); assertions++;
}

const originalFetch = global.fetch, originalWindow = global.window, originalDocument = global.document, originalUtterance = global.SpeechSynthesisUtterance, originalAudio = global.Audio;
(async () => {
  try {
    await narrationJourney(); await cloudNarrationJourney(); await animatedNarrationJourney(); await tutorJourney(); assessmentJourney(); await networkFailures();
    console.log(`PASS ${assertions} journey assertions: synchronized animated teaching, narration controls, tutor history, targeted review, assessment retries, and network failures.`);
    console.log('Speech and provider transport were stubbed; no live API calls were made.');
  } finally {
    global.fetch = originalFetch;
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
    if (originalDocument === undefined) delete global.document; else global.document = originalDocument;
    if (originalUtterance === undefined) delete global.SpeechSynthesisUtterance; else global.SpeechSynthesisUtterance = originalUtterance;
    if (originalAudio === undefined) delete global.Audio; else global.Audio = originalAudio;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
