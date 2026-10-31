/* eslint-disable @typescript-eslint/no-require-imports */
/** Offline integration checks: actual routes and UI handlers, stubbed provider transport. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
let hooks = [], hookIndex = 0, assertions = 0;
const React = {
  createContext: () => ({ Provider: 'Provider' }),
  useState(initial) {
    const index = hookIndex++, state = hooks;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  },
  useRef(initial) {
    const index = hookIndex++;
    return hooks[index] ??= { current: initial };
  },
  useEffect() {}, useCallback: callback => callback, useContext: () => null,
};
const jsx = (type, props) => ({ type, props });
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const item = { exports: {} };
  modules.set(filename, item);
  let code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  // Expose only the existing restore function in the in-memory test copy.
  if (relative === 'lib/learning-context.tsx') code += '\nexports.restoreForTest = restoreState;';
  const nativeRequire = NativeModule.createRequire(filename);
  function requireLocal(name) {
    if (name === 'server-only') return {};
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'next/link') return () => null;
    if (name.startsWith('@/')) {
      const target = ['.ts', '.tsx'].map(ext => name.slice(2) + ext).find(file => fs.existsSync(path.join(root, file)));
      return load(target);
    }
    return nativeRequire(name);
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(item.exports, requireLocal, item, filename, path.dirname(filename));
  return item.exports;
}
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
function check(condition, label) { assert.ok(condition, label); assertions++; }
const clone = value => JSON.parse(JSON.stringify(value));
const profile = {
  id: 'integration-learner', name: 'Alex', background: 'Economics degree with introductory statistics',
  experience: 'Analyzing customer reports', skills: ['Excel'], goals: 'Predict customer churn using Python',
  availableStudyTime: 5, track: 'data-science',
};
function curriculumDraft() {
  return {
    title: 'Python for customer churn analysis', summary: 'Build Python and analysis foundations before validating a churn baseline.',
    skippedMaterial: 'Advanced model deployment is beyond the initial goal.',
    modules: ['Python foundations', 'Prepare customer data', 'Explore churn patterns', 'Validate churn predictions'].map((title, index) => ({
      title, description: 'Beginner applied exercise: explain a customer analysis artifact.',
      inclusionReason: index ? 'Uses the preceding module to build toward the goal.' : 'Establishes the missing programming foundation.',
      topics: ['Python data operations', `Churn analysis step ${index + 1}`], estimatedDuration: 120,
      prerequisites: index ? [index - 1] : [], resourceIds: [index ? 'mit-data-science' : 'harvard-python'],
    })),
  };
}
function lectureDraft() {
  return {
    slides: ['Purpose and foundations', 'Explain the core idea', 'Worked example', 'Practice and reflect'].map((title, index) => ({
      title, bullets: [`Understand analysis step ${index + 1}.`, 'For example, 8 of 10 customers remain: retention is 80%.'],
      narration: 'Count retained customers, then divide by the total. Eight divided by ten is 0.8, or 80 percent. Check that the same time window is used for both counts.',
    })),
    quiz: ['Calculate retention', 'Choose a denominator', 'Check the time window'].map((question, index) => ({
      question, options: ['Eight of ten is 80 percent', 'Eight of ten is 8 percent', 'No denominator is needed', 'Time windows never matter'],
      correctAnswer: 0, explanation: `Review ${index + 1}: eight divided by ten is 0.8; use consistent counts and windows.`,
    })),
  };
}
let behavior = {}, calls = [];
function providerStub(options = {}) {
  behavior = options; calls = [];
  global.fetch = async (url, init) => {
    if (behavior.networkError) throw new Error('PRIVATE_PROVIDER_NETWORK_FAILURE');
    if (String(url) !== 'https://api.anthropic.com/v1/messages') {
      check(String(url).startsWith('https://'), 'Resource verification uses HTTPS');
      equal(init.headers, undefined, 'Resource verification sends no key');
      return new Response('Academic resource', { headers: { 'Content-Type': 'text/html' } });
    }
    const body = JSON.parse(init.body), payload = JSON.parse(body.messages[0].content);
    calls.push({ body, payload });
    const draft = behavior.draft ?? (payload.learner ? curriculumDraft() : payload.module ? lectureDraft() : { answer: 'Use the same denominator and time window as in the worked example.' });
    const envelope = { stop_reason: behavior.stopReason ?? 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }] };
    return new Response(behavior.raw ?? JSON.stringify(envelope), { status: behavior.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
}
async function post(endpoint, body) {
  const response = await load(`app/api/${endpoint}/route.ts`).POST(new Request(`http://localhost/api/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: response.status, data: await response.json() };
}
function render(Component, props, state) { hooks = state; hookIndex = 0; return Component(props); }
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [...(predicate(tree) ? [tree] : []), ...(Array.isArray(children) ? children : [children]).flat(Infinity).flatMap(child => find(child, predicate))];
}
async function fullFlow() {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE-OFFLINE-TEST-ONLY';
  providerStub();
  const planned = await post('plan', { profile });
  equal(planned.status, 200, 'Plan endpoint succeeds'); equal(planned.data.mode, 'claude', 'Plan reports Claude');
  const plan = planned.data.plan;
  const { assertStudyPlan, assertLesson } = load('lib/validators.ts');
  assertStudyPlan(plan); assertions++;
  equal(calls[0].payload.learner.goals, profile.goals, 'Goal reaches provider');
  check(plan.modules[0].id.startsWith('claude-'), 'Plan uses generated module IDs');
  const lessons = [];
  for (const learningModule of plan.modules.slice(0, 2)) {
    const generated = await post('lesson', { module: learningModule });
    equal(generated.status, 200, 'Generated module produces a lesson'); equal(generated.data.mode, 'claude', 'Lesson reports Claude');
    const lesson = generated.data.lesson; assertLesson(lesson); assertions++;
    equal(lesson.moduleId, learningModule.id, 'Module relationship preserved'); equal(lesson.title, learningModule.title, 'Selected module title preserved');
    equal(calls.at(-1).payload.module.topics, learningModule.topics, 'Selected module topics reach lecture author');
    check(lesson.slides.length >= 4 && lesson.slides.length <= 6, 'Four to six slides'); equal(lesson.quiz.length, 3, 'Three quizzes');
    lessons.push(lesson);
  }
  const lesson = lessons[0], firstQuestion = `[OwnPath slide: ${lesson.slides[0].id}]\nExplain the example.`;
  const chatted = await post('chat', { lesson, question: firstQuestion, messages: [] });
  equal(chatted.status, 200, 'Tutor accepts generated lecture'); equal(chatted.data.mode, 'claude', 'Tutor reports Claude');
  equal(calls.at(-1).payload.currentSlide, lesson.slides[0], 'Tutor receives active slide');
  const history = [{ id: 'user-1', role: 'user', content: firstQuestion }, chatted.data.message];
  const followed = await post('chat', { lesson, question: `[OwnPath slide: ${lesson.slides[1].id}]\nHow does that relate to this slide?`, messages: history });
  equal(followed.status, 200, 'Follow-up succeeds after navigation');
  equal(calls.at(-1).payload.history[0].slideId, lesson.slides[0].id, 'History retains previous slide');
  equal(calls.at(-1).payload.history[1].content, chatted.data.message.content, 'History retains tutor answer');
  equal(calls.at(-1).payload.currentSlide.id, lesson.slides[1].id, 'Current slide updates');
  check(!calls.at(-1).payload.question.includes('[OwnPath slide:'), 'Internal prefix stays outside learner question');
  await testProgress(plan, lesson);
  return { plan, lesson };
}
async function testProgress(plan, lesson) {
  const { LearningProvider, restoreForTest } = load('lib/learning-context.tsx');
  const { Quiz } = load('components/quiz.tsx');
  const initial = { version: 1, profile, plan: clone(plan), lessons: { [lesson.moduleId]: lesson }, quizResults: {} };
  const providerState = [initial, true, null];
  let quizState = [];
  let provider = render(LearningProvider, { children: null }, providerState);
  const props = {
    lesson, onComplete: provider.props.value.recordQuizResult,
    async onRetry() {
      // Exercise the real bounded quiz endpoint without making a provider call.
      const configuredKey = process.env.ANTHROPIC_API_KEY;
      try {
        delete process.env.ANTHROPIC_API_KEY;
        const generated = await post('quiz', { lesson, previousQuestions: lesson.quiz.map(question => question.question), questionCount: 5 });
        equal(generated.status, 200, 'Quiz setup generates a valid fresh assessment');
        equal(generated.data.quiz.length, 5, 'Quiz setup honors the five-question minimum');
        provider.props.value.replaceQuiz(lesson.id, lesson.moduleId, generated.data.quiz, plan.id);
      } finally {
        if (configuredKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = configuredKey;
      }
    },
  };
  let quiz = render(Quiz, props, quizState);
  equal(find(quiz, node => node.type === 'form').length, 0, 'Initial three-question content is gated by quiz setup');
  const generate = find(quiz, node => node.type === 'button' && node.props.onClick === props.onRetry)[0];
  check(generate, 'Quiz setup offers generation instead of a legacy assessment form');
  await generate.props.onClick();
  provider = render(LearningProvider, { children: null }, providerState);
  props.lesson = provider.props.value.state.lessons[lesson.moduleId];
  quizState = []; // Successful generation remounts the assessment with empty answers.
  quiz = render(Quiz, props, quizState);
  for (const question of props.lesson.quiz) {
    const answer = find(quiz, node => node.type === 'input').find(node => node.props.name === question.id && Number(node.props.value) === question.correctAnswer);
    answer.props.onChange(); quiz = render(Quiz, props, quizState);
  }
  find(quiz, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  provider = render(LearningProvider, { children: null }, providerState);
  const state = provider.props.value.state;
  equal(state.quizResults[lesson.moduleId].score, 100, 'Actual quiz scores answers');
  equal(state.plan.modules[0].status, 'completed', 'Actual state marks completion');
  equal(state.plan.modules[1].status, 'not-started', 'Actual state unlocks successor');
  const restored = restoreForTest(JSON.stringify(state));
  check(restored !== null, 'Browser state restores generated plan'); equal(restored.lessons[lesson.moduleId], props.lesson, 'Generated five-question lesson persists');
  equal(restored.quizResults[lesson.moduleId].score, 100, 'Quiz result persists');
}
async function fallbacksAndFailures(lesson) {
  for (const key of [undefined, '', '  ', 'YOUR_API_KEY_HERE']) {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key;
    providerStub();
    const plan = await post('plan', { profile }); equal(plan.data.mode, 'mock', 'Unconfigured plan stays mock');
    const generated = await post('lesson', { module: plan.data.plan.modules[0] }); equal(generated.data.mode, 'mock', 'Unconfigured lesson stays mock');
    const chat = await post('chat', { lesson: generated.data.lesson, question: 'Explain this lesson', messages: [] });
    equal(chat.data.mode, 'mock', 'Unconfigured tutor stays mock'); equal(calls.length, 0, 'Mock flow makes no provider calls');
  }
  process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE-OFFLINE-TEST-ONLY';
  const fixtures = [['plan', { profile }], ['lesson', { module: load('lib/mock-data.ts').createMockPlan(profile).modules[0] }], ['chat', { lesson, question: 'Explain this lesson', messages: [] }]];
  for (const [endpoint, body] of fixtures) {
    for (const options of [{ status: 401 }, { status: 429 }, { raw: 'PRIVATE_INVALID_PROVIDER_RESPONSE' }, { stopReason: 'max_tokens' }, { networkError: true }]) {
      providerStub(options); const result = await post(endpoint, body);
      equal(result.status, 500, `${endpoint} configured failure is not mock success`);
      equal(result.data.error.code, 'INTERNAL_ERROR', `${endpoint} stable error envelope`);
      check(!JSON.stringify(result.data).includes('PRIVATE_'), `${endpoint} hides provider details`);
      equal(result.data.mode, undefined, `${endpoint} no misleading mock label`);
    }
    equal((await post(endpoint, '{')).data.error.code, 'INVALID_JSON', `${endpoint} keeps invalid JSON contract`);
  }
  const wrongSlide = await post('chat', { lesson, question: '[OwnPath slide: unknown]\nExplain?', messages: [] });
  equal(wrongSlide.status, 400, 'Tutor rejects invented active slide');
  providerStub({ draft: { slides: [], quiz: [] } });
  equal((await post('lesson', fixtures[1][1])).status, 500, 'Malformed lesson rejected');
}

async function learnerProfiles() {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE-OFFLINE-TEST-ONLY';
  const beginner = { ...profile, background: 'High school algebra and no programming coursework', experience: '', skills: ['Excel', 'Algebra'] };
  const experienced = { ...profile, background: 'Statistics degree with linear algebra', experience: 'Three years of Python analysis projects', skills: ['Python', 'Statistics', 'pandas', 'SQL'] };
  for (const learner of [beginner, experienced]) {
    providerStub();
    const planned = await post('plan', { profile: learner });
    equal(planned.status, 200, 'Both same-goal learner profiles receive valid curricula');
    const supplied = calls[0].payload.learner;
    equal(supplied.background, learner.background, 'Educational background reaches curriculum engine');
    equal(supplied.experience, learner.experience, 'Work experience reaches curriculum engine');
    equal(supplied.skills, learner.skills, 'Demonstrated skills reach curriculum engine');
    equal(supplied.goals, profile.goals, 'Both profiles use the same goal');
    equal(supplied.availableStudyTime, learner.availableStudyTime, 'Study budget reaches curriculum engine');
  }
  // A transport fixture verifies context delivery, not actual model personalization.
}
function graphValidation(plan) {
  const { assertStudyPlan } = load('lib/validators.ts');
  const mutations = [
    ['duplicate IDs', p => { p.modules[1].id = p.modules[0].id; }],
    ['missing prerequisite', p => { p.modules[1].prerequisites = ['missing']; }],
    ['duplicate prerequisites', p => { p.modules[1].prerequisites.push(p.modules[0].id); }],
    ['cycle', p => { p.modules[0].prerequisites = [p.modules[1].id]; }],
    ['all locked', p => { p.modules.forEach(item => { item.status = 'locked'; }); }],
    ['invalid duration', p => { p.modules[0].estimatedDuration = 0; }],
    ['invalid status', p => { p.modules[0].status = 'unknown'; }],
    ['unsafe URL', p => { p.modules[0].resources[0].url = 'javascript:alert(1)'; }],
    ['invalid timestamp', p => { p.generatedAt = 'yesterday'; }],
  ];
  for (const [label, change] of mutations) {
    const invalid = clone(plan); change(invalid);
    assert.throws(() => assertStudyPlan(invalid), undefined, label); assertions++;
  }
}
async function clientValidation(plan, lesson) {
  const client = load('lib/api-client.ts');
  global.fetch = async () => Response.json({ plan, mode: 'claude' });
  equal(await client.requestPlan(profile), plan, 'Onboarding client accepts compatible generated plan');
  for (const changed of [{ profileId: 'another-learner' }, { track: 'web-development' }, { weeklyStudyHours: 7 }]) {
    global.fetch = async () => Response.json({ plan: { ...plan, ...changed }, mode: 'claude' });
    await assert.rejects(() => client.requestPlan(profile), /did not match/); assertions++;
  }
  global.fetch = async () => Response.json({ plan, mode: 'invented' });
  await assert.rejects(() => client.requestPlan(profile)); assertions++;
  global.fetch = async () => Response.json({ lesson, mode: 'claude' });
  equal((await client.requestLesson(plan.modules[0])).id, lesson.id, 'Lesson client accepts selected module');
  global.fetch = async () => Response.json({ lesson: { ...lesson, title: 'Unrelated topic' }, mode: 'claude' });
  await assert.rejects(() => client.requestLesson(plan.modules[0]), /did not match/); assertions++;
  const { restoreForTest } = load('lib/learning-context.tsx');
  const restored = restoreForTest(JSON.stringify({
    version: 1, profile, plan, lessons: { [lesson.moduleId]: { ...lesson, title: 'Outdated title' } }, quizResults: {},
  }));
  check(restored !== null, 'Stale lesson does not discard valid curriculum');
  equal(restored.lessons, {}, 'Stale lesson with wrong title is evicted');
}

async function persistenceJourneys(plan, lesson) {
  const { LearningProvider, restoreForTest } = load('lib/learning-context.tsx');
  const state = [{ version: 1, profile, plan: clone(plan), lessons: { [lesson.moduleId]: lesson }, quizResults: {}, planMode: 'claude', lessonModes: { [lesson.moduleId]: 'claude' } }, true, null];
  const provider = () => render(LearningProvider, { children: null }, state).props.value;
  const failed = { lessonId: lesson.id, moduleId: lesson.moduleId, correctAnswers: 1, totalQuestions: 3, score: 33, passed: false, completedAt: new Date().toISOString() };
  provider().recordQuizResult(failed);
  equal(provider().state.plan.modules[1].status, 'locked', 'A failed quiz does not unlock the next module');
  const restoredFailure = restoreForTest(JSON.stringify(provider().state));
  equal(restoredFailure.quizResults[lesson.moduleId], failed, 'Failed quiz results survive restoration');
  equal(restoredFailure.planMode, 'claude', 'Curriculum mode survives refresh');
  equal(restoredFailure.lessonModes[lesson.moduleId], 'claude', 'Lesson mode survives refresh');
  const passed = { ...failed, correctAnswers: 3, score: 100, passed: true };
  provider().recordQuizResult(passed); provider().recordQuizResult(failed);
  equal(provider().state.quizResults[lesson.moduleId].score, 100, 'A later failed practice attempt preserves the best passed score');
  equal(provider().state.plan.modules[0].status, 'completed', 'A failed practice attempt cannot relock a completed module');
  const legacy = clone(provider().state); delete legacy.planMode; delete legacy.lessonModes;
  const restoredLegacy = restoreForTest(JSON.stringify(legacy));
  check(restoredLegacy !== null, 'Old version-one storage remains compatible');
  equal(restoredLegacy.planMode, undefined, 'Unknown old plan mode is not guessed');
  equal(restoredLegacy.lessonModes, {}, 'Unknown old lesson mode is not guessed');
  const unordered = clone(legacy); unordered.plan.modules.reverse();
  equal(restoreForTest(JSON.stringify(unordered)).plan.modules.map(item => item.id), plan.modules.map(item => item.id), 'Valid saved modules restore in prerequisite order');

  const { createMockPlan } = load('lib/mock-data.ts');
  const { generateLesson } = load('lib/ai.ts');
  const oldPlan = createMockPlan(profile), newPlan = createMockPlan(profile);
  const oldLesson = (await generateLesson({ module: oldPlan.modules[0] })).lesson;
  provider().setPlan(profile, oldPlan, 'mock');
  const oldGeneration = provider().state.planGeneration;
  provider().saveLesson(oldLesson, 'mock', oldPlan.id);
  provider().recordQuizResult({ ...passed, lessonId: oldLesson.id, moduleId: oldLesson.moduleId });
  provider().setPlan(profile, newPlan, 'mock');
  equal(newPlan.id, oldPlan.id, 'Regression fixture reuses the deterministic mock plan ID');
  check(provider().state.planGeneration !== oldGeneration, 'Regenerating even the same mock plan gets a fresh local generation');
  equal(provider().state.lessons, {}, 'A new plan clears incompatible cached lessons');
  equal(provider().state.quizResults, {}, 'A new plan clears incompatible quiz results');
  equal(provider().state.lessonModes, {}, 'A new plan clears incompatible lesson-mode metadata');
  equal(provider().state.planMode, 'mock', 'New plan replaces the previous live-mode label');
  provider().saveLesson(oldLesson, 'mock', oldPlan.id, oldGeneration);
  provider().startModule(oldLesson.moduleId, oldPlan.id, oldGeneration);
  provider().recordQuizResult({ ...passed, lessonId: oldLesson.id, moduleId: oldLesson.moduleId });
  equal(provider().state.lessons, {}, 'Late old-plan lesson cannot contaminate a replacement with the same catalog IDs');
  equal(provider().state.quizResults, {}, 'Late old-plan quiz cannot unlock a replacement curriculum');
  equal(provider().state.plan.modules[0].status, 'not-started', 'Late start callback cannot mutate replacement progress');
  const currentLesson = (await generateLesson({ module: newPlan.modules[0] })).lesson;
  provider().saveLesson(currentLesson, 'mock', newPlan.id);
  equal(provider().state.lessonModes[currentLesson.moduleId], 'mock', 'Current mock lesson retains its actual mode');
}
const originalFetch = global.fetch, originalKey = process.env.ANTHROPIC_API_KEY;
(async () => {
  try {
    const { plan, lesson } = await fullFlow();
    graphValidation(plan); await fallbacksAndFailures(lesson); await clientValidation(plan, lesson); await learnerProfiles(); await persistenceJourneys(plan, lesson);
    console.log(`PASS ${assertions} integration assertions: plan → lesson → slide-aware tutor → quiz → persisted progress; mocks, graph validation, and safe provider failures.`);
    console.log('Provider transport was stubbed; this test makes no live API calls.');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
