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
      useCallback(callback) { index++; return callback; },
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
  quiz: Array.from({ length: 3 }, (_, index) => ({ id: `quiz-${index}`, question: `Retention check ${index + 1}?`, options: ['Use matching counts', 'Ignore the denominator', 'Ignore dates', 'Assume 100 percent'], correctAnswer: 0, explanation: `Check ${index + 1}: match the denominator and observation period.` })),
};

function narrationJourney() {
  const spoken = []; let pauses = 0, resumes = 0, cancellations = 0, slideIndex = 0;
  const windowEvents = new Map(), documentEvents = new Map();
  global.window = {
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    removeEventListener: name => windowEvents.delete(name),
    speechSynthesis: { speak: utterance => spoken.push(utterance), pause: () => pauses++, resume: () => resumes++, cancel: () => cancellations++ },
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
  let tree = render(); button(tree, 'Play narration').props.onClick(); tree = render();
  equal(spoken.length, 1, 'Play creates one utterance');
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
  const before = cancellations; state.unmount();
  check(cancellations > before && pauseNarrationRef.current === null, 'Leaving the lesson cancels speech and clears its controller');
  delete window.speechSynthesis;
  const unsupported = hooks();
  const { LecturePlayer: WithoutSpeech } = load('components/lecture-player.tsx', componentOverrides(unsupported));
  const renderUnsupported = () => unsupported.render(() => WithoutSpeech({ lesson, slideIndex: 0, onSlideChange() {}, pauseNarrationRef: { current: null } }));
  let fallback = renderUnsupported(); button(fallback, 'Play narration').props.onClick(); fallback = renderUnsupported();
  check(text(fallback).includes('does not support narration'), 'Unsupported speech offers transcript guidance');
  unsupported.unmount();
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
  const state = hooks(), attempts = [], reviewPrompts = [];
  const { Quiz } = load('components/quiz.tsx', componentOverrides(state));
  const props = { lesson, onComplete: result => attempts.push(result), onReview: question => reviewPrompts.push(question) };
  const render = () => state.render(() => Quiz(props)); let tree = render();
  function answerAll(index) {
    for (const question of lesson.quiz) {
      find(tree, node => node.type === 'input' && node.props.name === question.id && Number(node.props.value) === index).props.onChange(); tree = render();
    }
  }
  answerAll(1); find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); tree = render();
  equal(attempts[0].score, 0, 'Incorrect choices fail with the correct score');
  check(text(tree).includes('Focus your next review'), 'Failure provides targeted review guidance');
  check(text(tree).includes(lesson.quiz[0].explanation), 'Failure explains the actual missed question');
  button(tree, 'Review this question with tutor').props.onClick();
  check(reviewPrompts[0].includes(lesson.quiz[0].question) && reviewPrompts[0].includes(lesson.quiz[0].explanation), 'Review action carries the specific missed question and reasoning');
  button(tree, 'Practice again').props.onClick(); tree = render();
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

const originalFetch = global.fetch, originalWindow = global.window, originalDocument = global.document, originalUtterance = global.SpeechSynthesisUtterance;
(async () => {
  try {
    narrationJourney(); await tutorJourney(); assessmentJourney(); await networkFailures();
    console.log(`PASS ${assertions} journey assertions: narration, consecutive questions, error/retry history, targeted quiz review, fail/retry/pass, and network failures.`);
    console.log('Speech and provider transport were stubbed; no live API calls were made.');
  } finally {
    global.fetch = originalFetch;
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
    if (originalDocument === undefined) delete global.document; else global.document = originalDocument;
    if (originalUtterance === undefined) delete global.SpeechSynthesisUtterance; else global.SpeechSynthesisUtterance = originalUtterance;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
