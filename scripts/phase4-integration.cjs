/* eslint-disable @typescript-eslint/no-require-imports */
/** Offline regressions against actual Phase 4 route, quiz, and state handlers. */
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
  useRef(initial) { const index = hookIndex++; return hooks[index] ??= { current: initial }; },
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
function check(value, label) { assert.ok(value, label); assertions++; }
function throws(run, label) { assert.throws(run, undefined, label); assertions++; }
const clone = value => JSON.parse(JSON.stringify(value));
function render(Component, props, state) { hooks = state; hookIndex = 0; return Component(props); }
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [...(predicate(tree) ? [tree] : []), ...(Array.isArray(children) ? children : [children]).flat(Infinity).flatMap(child => find(child, predicate))];
}
const profile = {
  id: 'phase4-learner', name: 'Alex', background: 'High school algebra', experience: '', skills: ['Excel'],
  goals: 'Predict customer churn using Python', availableStudyTime: 5, track: 'data-science',
};
function provider(state) {
  const { LearningProvider } = load('lib/learning-context.tsx');
  return () => render(LearningProvider, { children: null }, state).props.value;
}
function attempt(lesson, correctCount, completedAt) {
  const answers = Object.fromEntries(lesson.quiz.map((question, index) => [question.id,
    index < correctCount ? question.correctAnswer : (question.correctAnswer + 1) % question.options.length]));
  const score = Math.round(correctCount / lesson.quiz.length * 100);
  return {
    lessonId: lesson.id, moduleId: lesson.moduleId, answers,
    missedQuestionIds: lesson.quiz.filter(question => answers[question.id] !== question.correctAnswer).map(question => question.id),
    correctAnswers: correctCount, totalQuestions: lesson.quiz.length, score, passed: score >= 70, completedAt,
  };
}
async function post(body, extra = {}) {
  const response = await load('app/api/review/route.ts').POST(new Request('http://localhost/api/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: response.status, data: await response.json(), headers: response.headers };
}
const FAKE_KEY = 'sk-ant-FAKE-PHASE4-OFFLINE-ONLY';
let calls = [];
function stubProvider(options = {}) {
  calls = [];
  global.fetch = async (url, init) => {
    equal(String(url), 'https://api.anthropic.com/v1/messages', 'Review only calls the configured provider boundary');
    const body = JSON.parse(init.body), payload = JSON.parse(body.messages[0].content);
    calls.push({ body, payload, headers: init.headers });
    if (options.networkError) throw new Error('PRIVATE_PROVIDER_DETAIL');
    const areas = payload.mistakes.map(mistake => ({
      questionId: mistake.questionId,
      explanation: `Compare your choice with the supplied reasoning: ${mistake.question.explanation}`,
      workedExample: 'First identify the evidence, then apply the reasoning and compare the resulting choices.',
      steps: ['Read the referenced slide and explain its teaching point.', 'Solve the missed question again and explain the rejected choice.'],
    }));
    const draft = options.draft ?? { areas };
    return new Response(options.raw ?? JSON.stringify({
      stop_reason: options.stopReason ?? 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }],
    }), { status: options.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
}

async function stateJourney() {
  delete process.env.ANTHROPIC_API_KEY;
  const { createMockPlan } = load('lib/mock-data.ts');
  const { generateLesson } = load('lib/ai.ts');
  const { createMockReview, assertReviewResponse } = load('lib/remediation.ts');
  const { restoreForTest } = load('lib/learning-context.tsx');
  const { Quiz } = load('components/quiz.tsx');
  const plan = createMockPlan(profile), originalLesson = (await generateLesson({ module: plan.modules[0] })).lesson;
  let lesson = originalLesson;
  const state = [{ version: 1, profile, plan, lessons: { [lesson.moduleId]: lesson }, quizResults: {}, planGeneration: 'generation-one' }, true, null];
  const current = provider(state);
  let quizState = [];
  let completed;
  const props = {
    lesson,
    onComplete: result => { completed = result; current().recordQuizResult(result); },
    async onRetry() {
      const response = await load('app/api/quiz/route.ts').POST(new Request('http://localhost/api/quiz', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson, previousQuestions: lesson.quiz.map(question => question.question), questionCount: 5 }),
      }));
      equal(response.status, 200, 'Quiz setup generates fresh questions before assessment');
      const generated = await response.json();
      equal(generated.quiz.length, 5, 'Quiz setup generates the minimum five questions');
      current().replaceQuiz(lesson.id, lesson.moduleId, generated.quiz, plan.id, 'generation-one');
    },
  };
  let quiz = render(Quiz, props, quizState);
  equal(find(quiz, node => node.type === 'form').length, 0, 'Initial three-question lesson waits for quiz setup');
  const generate = find(quiz, node => node.type === 'button' && node.props.onClick === props.onRetry)[0];
  check(generate, 'Quiz setup offers a generation action');
  await generate.props.onClick();
  lesson = current().state.lessons[lesson.moduleId];
  props.lesson = lesson;
  quizState = []; // The parent remounts only after a successful question refresh.
  quiz = render(Quiz, props, quizState);
  find(quiz, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  quiz = render(Quiz, props, quizState);
  check(find(quiz, node => node.props?.role === 'alert').length, 'Incomplete quiz presents validation feedback');
  equal(current().state.quizResults, {}, 'Incomplete quiz does not save progress');
  for (const [index, question] of lesson.quiz.entries()) {
    const choice = index ? (question.correctAnswer + 1) % question.options.length : question.correctAnswer;
    find(quiz, node => node.type === 'input' && node.props.name === question.id && Number(node.props.value) === choice)[0].props.onChange();
    quiz = render(Quiz, props, quizState);
  }
  find(quiz, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  equal(completed.score, 20, 'Actual quiz handler derives one-of-five failed score');
  equal(completed.missedQuestionIds, lesson.quiz.slice(1).map(question => question.id), 'Actual quiz identifies only wrong answers');
  equal(current().state.plan.modules[1].status, 'locked', 'Failed quiz leaves prerequisite successor locked');
  const reviewed = await post({ lesson, result: completed });
  equal(reviewed.status, 200, 'Failed quiz can request remediation');
  equal(reviewed.headers.get('cache-control'), 'no-store', 'Remediation responses cannot be cached');
  assertReviewResponse(reviewed.data, lesson, completed); assertions++;
  equal(reviewed.data.review.areas.map(area => area.questionId), completed.missedQuestionIds, 'Review covers exactly missed questions');
  current().saveRemediation(reviewed.data, plan.id, 'generation-one', completed);
  current().markRemediationReviewed(lesson.moduleId, completed.completedAt);
  equal(current().state.plan.modules[0].status, 'in-progress', 'Reading remediation does not claim completion');
  equal(current().state.plan.modules[1].status, 'locked', 'Reading remediation cannot unlock prerequisites');
  let restored = restoreForTest(JSON.stringify(current().state));
  equal(restored.latestQuizResults[lesson.moduleId], completed, 'Latest attempt and per-answer diagnostics restore');
  equal(restored.quizHistory[lesson.moduleId].length, 1, 'Attempt history restores');
  check(restored.remediations[lesson.moduleId].reviewedAt, 'Review completion persists across reload');
  equal(restored.remediations[lesson.moduleId].review, reviewed.data.review, 'Generated remediation restores unchanged');
  const passed = attempt(lesson, lesson.quiz.length, '2026-10-30T22:01:00.000Z');
  current().recordQuizResult(passed);
  equal(current().state.plan.modules[0].status, 'completed', 'Passing retake completes current module');
  equal(current().state.plan.modules[1].status, 'not-started', 'Passing retake unlocks successor');
  equal(current().state.remediations[lesson.moduleId], undefined, 'New attempt discards obsolete remediation');
  const failedAgain = attempt(lesson, 0, '2026-10-30T22:02:00.000Z');
  current().recordQuizResult(failedAgain);
  equal(current().state.quizResults[lesson.moduleId].score, 100, 'Failed practice preserves best passing score');
  equal(current().state.latestQuizResults[lesson.moduleId].score, 0, 'Latest diagnostics still track failed practice');
  equal(current().state.plan.modules[0].status, 'completed', 'Failed practice preserves completed module');
  equal(current().state.plan.modules[1].status, 'not-started', 'Failed practice preserves unlocked successor');
  current().saveRemediation(reviewed.data, plan.id, 'generation-one', completed);
  equal(current().state.remediations[lesson.moduleId], undefined, 'Stale review cannot overwrite newer attempt');
  const newReview = createMockReview({ lesson, result: failedAgain });
  current().saveRemediation(newReview, plan.id, 'stale-generation', failedAgain);
  equal(current().state.remediations[lesson.moduleId], undefined, 'Stale generation cannot save review');
  current().saveRemediation(newReview, plan.id, 'generation-one', failedAgain);
  check(current().state.remediations[lesson.moduleId], 'Current generation accepts matching attempt');

  const legacyResult = { ...passed }; delete legacyResult.answers; delete legacyResult.missedQuestionIds;
  restored = restoreForTest(JSON.stringify({ version: 1, profile, plan: createMockPlan(profile), lessons: { [lesson.moduleId]: lesson }, quizResults: { [lesson.moduleId]: legacyResult } }));
  equal(restored.quizResults[lesson.moduleId], legacyResult, 'Phase 3 score-only progress migrates');
  equal(restored.latestQuizResults[lesson.moduleId], legacyResult, 'Legacy best score becomes last known attempt');
  equal(restored.plan.modules[1].status, 'not-started', 'Legacy passing result keeps successor available');
  equal(restored.remediations, {}, 'Legacy score-only result does not invent diagnostic review');
  const corrupted = clone(current().state);
  corrupted.remediations[lesson.moduleId].review.areas[0].questionId = 'not-in-this-lesson';
  corrupted.lessonModes = { [lesson.moduleId]: 'invented' };
  restored = restoreForTest(JSON.stringify(corrupted));
  check(restored?.plan, 'Invalid optional review metadata cannot erase a valid path');
  equal(restored.remediations, {}, 'Corrupt optional review is evicted');
  equal(restored.lessonModes, {}, 'Unknown lesson mode is evicted');
  equal(restored.quizResults[lesson.moduleId].score, 100, 'Corrupt review does not erase best passing result');
  const replacement = clone(lesson);
  replacement.quiz[0].correctAnswer = (replacement.quiz[0].correctAnswer + 1) % replacement.quiz[0].options.length;
  current().saveLesson(replacement, 'mock', plan.id, 'generation-one');
  equal(current().state.latestQuizResults[lesson.moduleId], undefined, 'Same-ID lesson replacement invalidates current diagnostics');
  equal(current().state.remediations[lesson.moduleId], undefined, 'Same-ID lesson replacement invalidates old review');
  equal(current().state.quizResults[lesson.moduleId].score, 100, 'Lesson replacement preserves historical best progress');
  current().saveRemediation(newReview, plan.id, 'generation-one', failedAgain);
  equal(current().state.remediations[lesson.moduleId], undefined, 'Old review cannot fall back to historical best after replacement');
  restored = restoreForTest(JSON.stringify(current().state));
  equal(restored.latestQuizResults, {}, 'Reload preserves intentional invalidation of current diagnostics');
  equal(restored.remediations, {}, 'Reload does not resurrect old review');
  equal(restored.quizResults[lesson.moduleId].score, 100, 'Reload preserves historical best after changed same-ID quiz');
  const replacementFailure = attempt(replacement, 0, '2026-10-30T22:03:00.000Z');
  current().recordQuizResult(replacementFailure, plan.id, 'generation-one');
  restored = restoreForTest(JSON.stringify(current().state));
  equal(restored.quizResults[lesson.moduleId].score, 100, 'Current changed-quiz failure does not invalidate historical best during reload');
  equal(restored.latestQuizResults[lesson.moduleId], replacementFailure, 'Changed-quiz current diagnostics survive reload');
  equal(restored.quizHistory[lesson.moduleId].length, 4, 'Historical attempts survive a newly assessed changed quiz');
  const oldGeneration = current().state.planGeneration;
  current().setPlan(profile, createMockPlan(profile), 'mock');
  check(current().state.planGeneration !== oldGeneration, 'Replacing identical mock plan creates new generation');
  current().saveLesson(lesson, 'mock', plan.id, oldGeneration);
  current().startModule(lesson.moduleId, plan.id, oldGeneration);
  current().recordQuizResult(passed, plan.id, oldGeneration);
  current().saveRemediation(newReview, plan.id, oldGeneration, failedAgain);
  equal(current().state.lessons, {}, 'Old generation cannot populate replacement lesson cache');
  equal(current().state.quizResults, {}, 'Old generation cannot complete replacement module');
  equal(current().state.remediations, {}, 'Old generation cannot contaminate replacement reviews');
  equal(current().state.plan.modules[0].status, 'not-started', 'Old generation cannot start replacement module');
  return { lesson, result: completed };
}

async function prerequisiteJourney() {
  const { createMockPlan } = load('lib/mock-data.ts');
  const { generateLesson } = load('lib/ai.ts');
  const plan = createMockPlan(profile);
  plan.modules[1].prerequisites = []; plan.modules[1].status = 'not-started';
  plan.modules[2].prerequisites = [plan.modules[0].id, plan.modules[1].id];
  const lessons = await Promise.all(plan.modules.slice(0, 3).map(async module => (await generateLesson({ module })).lesson));
  const current = provider([{ version: 1, profile, plan, lessons: Object.fromEntries(lessons.map(lesson => [lesson.moduleId, lesson])), quizResults: {} }, true, null]);
  const byId = id => current().state.plan.modules.find(module => module.id === id);
  current().recordQuizResult(attempt(lessons[2], 3, '2026-10-30T22:00:00.000Z'));
  equal(byId(lessons[2].moduleId).status, 'locked', 'Locked module cannot be completed via result callback');
  current().recordQuizResult(attempt(lessons[0], 3, '2026-10-30T22:01:00.000Z'));
  equal(byId(lessons[2].moduleId).status, 'locked', 'One of two prerequisites does not unlock a module');
  current().startModule(lessons[2].moduleId);
  equal(byId(lessons[2].moduleId).status, 'locked', 'Locked module cannot be started directly');
  current().recordQuizResult(attempt(lessons[1], 3, '2026-10-30T22:02:00.000Z'));
  equal(byId(lessons[2].moduleId).status, 'not-started', 'All completed prerequisites unlock a module');
}

async function routeJourney(lesson, result) {
  for (const key of [undefined, '', ' ', 'YOUR_API_KEY_HERE']) {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key;
    stubProvider();
    const response = await post({ lesson, result });
    equal(response.data.mode, 'mock', 'Unconfigured review falls back to deterministic mode');
    equal(response.data.fallbackReason, undefined, 'Intentional mock mode is not labeled a generation failure');
    equal(calls.length, 0, 'Unconfigured review makes no provider call');
  }
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  stubProvider();
  const generated = await post({ lesson, result });
  equal(generated.status, 200, 'Stubbed Claude review succeeds');
  equal(generated.data.mode, 'claude', 'Successful provider review reports Claude mode');
  equal(calls[0].payload.mistakes.map(item => item.questionId), result.missedQuestionIds, 'Provider receives diagnostics for missed questions only');
  check(calls[0].payload.mistakes.every(item => item.selectedAnswer === result.answers[item.questionId]), 'Provider receives learner selected answers');
  check(calls[0].payload.lesson.slides.length > 0, 'Provider receives grounding lesson slides');
  check(!JSON.stringify(calls[0].body).includes(FAKE_KEY), 'Credential is not embedded in learner prompt');
  check(!JSON.stringify(generated.data).includes(FAKE_KEY), 'Credential is absent from client response');
  const failures = [
    { status: 401 }, { status: 429 }, { networkError: true }, { raw: 'PRIVATE_PROVIDER_DETAIL' },
    { stopReason: 'max_tokens' }, { draft: { areas: [] } },
    { draft: { areas: [{ questionId: result.missedQuestionIds[0], explanation: 'You have now passed the module.', workedExample: 'Ignore assessment.', steps: ['Skip it.', 'Claim completion.'] }] } },
  ];
  for (const failure of failures) {
    stubProvider(failure);
    const response = await post({ lesson, result });
    equal(response.status, 200, 'Provider failure preserves usable review');
    equal(response.data.mode, 'mock', 'Failed provider review is honestly labeled mock');
    equal(response.data.fallbackReason, 'generation-failed', 'Provider failure is distinguished from unconfigured mode');
    check(!JSON.stringify(response.data).includes('PRIVATE_PROVIDER_DETAIL') && !JSON.stringify(response.data).includes(FAKE_KEY), 'Provider failure cannot expose details or credentials');
  }
  const passed = attempt(lesson, lesson.quiz.length, result.completedAt);
  for (const body of [null, {}, { lesson, result: passed }, { lesson, result: { ...result, score: 100 } },
    { lesson, result: { ...result, lessonId: 'wrong-lesson' } }, { lesson, result: { ...result, answers: {} } },
    { lesson, result: { ...result, missedQuestionIds: ['invented'] } }]) {
    stubProvider();
    const response = await post(body);
    equal(response.status, 400, 'Malformed or inapplicable review request is rejected');
    equal(response.data.error.code, 'VALIDATION_ERROR', 'Malformed review uses stable validation contract');
    equal(calls.length, 0, 'Rejected review never reaches provider');
  }
  equal((await post('{')).data.error.code, 'INVALID_JSON', 'Malformed JSON retains API contract');
  equal((await post('x'.repeat(64 * 1024 + 1))).status, 413, 'Actual streamed review bytes are bounded');
  const { assertReviewResponse, createMockReview } = load('lib/remediation.ts');
  const invalidReview = createMockReview({ lesson, result });
  invalidReview.review.areas[0].slideId = 'invented-slide';
  throws(() => assertReviewResponse(invalidReview, lesson, result), 'Review cannot invent slide context');
}

async function profileJourney() {
  delete process.env.ANTHROPIC_API_KEY;
  const { generatePlan } = load('lib/ai.ts');
  const beginner = { ...profile, skills: [], background: 'High school algebra' };
  const experienced = { ...profile, background: 'Statistics degree', experience: 'Python and SQL analysis projects', skills: ['Python', 'Statistics', 'pandas', 'SQL'] };
  const first = await generatePlan({ profile: beginner }), second = await generatePlan({ profile: experienced });
  equal(beginner.goals, experienced.goals, 'Profile comparison uses identical learning goals');
  equal(first.mode, 'mock', 'Beginner fallback plan is explicitly mock');
  equal(second.mode, 'mock', 'Experienced fallback plan is explicitly mock');
  check(first.plan.summary !== second.plan.summary, 'Different background and skills change mock assessment summary');
  check(second.plan.modules.some((module, index) => module.estimatedDuration < first.plan.modules[index].estimatedDuration), 'Demonstrated skills condense relevant fallback modules');
  check(second.plan.modules.some((module, index) => module.description !== first.plan.modules[index].description), 'Existing skills affect fallback review guidance');
  equal(second.plan.modules[0].status, 'not-started', 'Existing skills do not claim unassessed completion');
  check(second.plan.modules.slice(1).every(module => module.status === 'locked'), 'Experienced profile still requires assessments for prerequisites');
}

const originalFetch = global.fetch, originalKey = process.env.ANTHROPIC_API_KEY;
(async () => {
  try {
    const { lesson, result } = await stateJourney();
    await prerequisiteJourney(); await routeJourney(lesson, result); await profileJourney();
    console.log(`PASS ${assertions} Phase 4 integration assertions: diagnostic review, persistence migration, retakes, prerequisite graph, stale generation protection, safe fallback, and same-goal profiles.`);
    console.log('Provider transport is stubbed; no live credentials or external API calls are required.');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
