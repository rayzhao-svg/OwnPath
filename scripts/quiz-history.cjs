/* eslint-disable @typescript-eslint/no-require-imports */
/** Actual state, review, and restoration handlers across fresh quiz attempts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
let cells = [], hookIndex = 0, assertions = 0;
const React = {
  createContext: () => ({ Provider: 'Provider' }),
  useState(initial) {
    const index = hookIndex++, state = cells;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  },
  useRef(initial) { return cells[hookIndex++] ??= { current: initial }; },
  useEffect() {}, useCallback: callback => callback, useContext: () => null,
};
function load(relative, overrides = {}, cache = modules) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  let code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  if (relative === 'lib/learning-context.tsx') code += '\nexports.restoreForTest = restoreState;';
  const nativeRequire = NativeModule.createRequire(filename);
  const requireLocal = name => {
    if (name in overrides) return overrides[name];
    if (name === 'server-only') return {};
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name.startsWith('@/')) {
      const target = ['.ts', '.tsx'].map(ext => name.slice(2) + ext).find(file => fs.existsSync(path.join(root, file)));
      return load(target, overrides, cache);
    }
    return nativeRequire(name);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(item.exports, requireLocal, item, filename, path.dirname(filename));
  return item.exports;
}
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (value, label) => { assert.ok(value, label); assertions++; };
const rejects = (run, label) => { assert.throws(run, undefined, label); assertions++; };
const clone = value => JSON.parse(JSON.stringify(value));
const profile = { id: 'quiz-refresh-learner', name: 'Alex', background: 'High school algebra', experience: '', skills: ['Excel'], goals: 'Analyze customer data with Python', availableStudyTime: 5, track: 'data-science' };
function harness(initial) {
  const state = [clone(initial), true, null];
  const { LearningProvider } = load('lib/learning-context.tsx');
  return () => {
    cells = state; hookIndex = 0;
    return LearningProvider({ children: null }).props.value;
  };
}
function attempt(lesson, questions, correctCount, time, snapshot = true) {
  const answers = Object.fromEntries(questions.map((question, index) => [question.id,
    index < correctCount ? question.correctAnswer : (question.correctAnswer + 1) % question.options.length]));
  const score = Math.round(correctCount / questions.length * 100);
  return {
    lessonId: lesson.id, moduleId: lesson.moduleId, answers,
    correctAnswers: correctCount, totalQuestions: questions.length, score, passed: score >= 70,
    completedAt: `2026-10-31T12:${String(time).padStart(2, '0')}:00.000Z`,
    missedQuestionIds: questions.filter(question => answers[question.id] !== question.correctAnswer).map(question => question.id),
    ...(snapshot ? { questions: clone(questions) } : {}),
  };
}

(async () => {
  const { createMockPlan } = load('lib/mock-data.ts');
  const { generateLesson } = load('lib/ai.ts');
  const { assertQuizResult } = load('lib/validators.ts');
  const { assertAttemptForLesson, lessonForAttempt, createMockReview, assertReviewResponse, diagnoseMistakes } = load('lib/remediation.ts');
  const { restoreForTest } = load('lib/learning-context.tsx');
  const plan = createMockPlan(profile);
  const lesson = (await generateLesson({ module: plan.modules[0] })).lesson;
  const initial = { version: 1, profile, plan, lessons: { [lesson.moduleId]: lesson }, quizResults: {}, latestQuizResults: {}, quizHistory: {}, remediations: {}, planGeneration: 'quiz-generation-one' };
  const current = harness(initial);
  const legacyFailure = attempt(lesson, lesson.quiz, 1, 0, false);
  current().recordQuizResult(legacyFailure, plan.id, 'quiz-generation-one');
  const oldReview = createMockReview({ lesson, result: legacyFailure });
  current().saveRemediation(oldReview, plan.id, 'quiz-generation-one', legacyFailure);
  current().markRemediationReviewed(lesson.moduleId, legacyFailure.completedAt);
  const first = lesson.quiz.map((question, index) => ({ ...clone(question), id: `fresh-one-${index}`, question: `New application ${index + 1}: ${question.question}` }));
  current().replaceQuiz(lesson.id, lesson.moduleId, first, plan.id, 'quiz-generation-one');
  let state = current().state;
  equal(state.lessons[lesson.moduleId].quiz, first, 'Fresh questions become the active saved quiz');
  equal(state.lessons[lesson.moduleId].slides, lesson.slides, 'Refreshing questions leaves the lecture unchanged');
  equal(state.lessons[lesson.moduleId].id, lesson.id, 'Refreshing questions keeps the lesson identity');
  equal(state.quizResults[lesson.moduleId].questions, lesson.quiz, 'Existing best result gains its exact old question snapshot');
  equal(state.latestQuizResults[lesson.moduleId].questions, lesson.quiz, 'Existing latest result gains its exact old question snapshot');
  equal(state.quizHistory[lesson.moduleId][0].questions, lesson.quiz, 'Existing history gains the old question snapshot');
  equal(legacyFailure.questions, undefined, 'Migration does not mutate the caller’s old result');
  check(state.remediations[lesson.moduleId].reviewedAt, 'Refreshing retains the old reviewed explanation');
  equal(state.plan.modules[0].status, 'in-progress', 'Refreshing alone cannot complete a module');
  equal(state.plan.modules[1].status, 'locked', 'Refreshing alone cannot unlock prerequisites');
  assertAttemptForLesson(state.lessons[lesson.moduleId], state.latestQuizResults[lesson.moduleId], true); assertions++;
  assertReviewResponse(state.remediations[lesson.moduleId], state.lessons[lesson.moduleId], state.latestQuizResults[lesson.moduleId]); assertions++;

  const passed = attempt(lesson, first, first.length, 1);
  current().recordQuizResult(passed, plan.id, 'quiz-generation-one');
  equal(current().state.quizResults[lesson.moduleId].score, 100, 'A fresh-question passing result is recorded');
  equal(current().state.plan.modules[0].status, 'completed', 'A fresh-question pass completes the module');
  equal(current().state.plan.modules[1].status, 'not-started', 'A fresh-question pass unlocks the successor');
  const second = first.map((question, index) => ({ ...clone(question), id: `fresh-two-${index}`, question: `Different case ${index + 1}: ${question.question}` }));
  current().replaceQuiz(lesson.id, lesson.moduleId, second, plan.id, 'quiz-generation-one');
  const failed = attempt(lesson, second, 0, 2);
  current().recordQuizResult(failed, plan.id, 'quiz-generation-one');
  equal(current().state.quizResults[lesson.moduleId], passed, 'Failing a new retake preserves the earlier best passing result');
  equal(current().state.latestQuizResults[lesson.moduleId], failed, 'Latest diagnostics use the actual newly failed questions');
  equal(current().state.quizHistory[lesson.moduleId].length, 3, 'Every scored question set is retained in history');
  equal(current().state.plan.modules[0].status, 'completed', 'A later failure cannot undo completion');
  equal(current().state.plan.modules[1].status, 'not-started', 'A later failure cannot relock an unlocked successor');

  const latestLesson = current().state.lessons[lesson.moduleId];
  const latestReview = createMockReview({ lesson: latestLesson, result: failed });
  current().saveRemediation(latestReview, plan.id, 'quiz-generation-one', failed);
  const third = second.map((question, index) => ({ ...clone(question), id: `fresh-three-${index}`, question: `Next practice ${index + 1}: ${question.question}` }));
  current().replaceQuiz(lesson.id, lesson.moduleId, third, plan.id, 'quiz-generation-one');
  state = current().state;
  equal(lessonForAttempt(state.lessons[lesson.moduleId], failed).quiz, second, 'Historical diagnostics resolve the actual failed question set');
  equal(diagnoseMistakes(state.lessons[lesson.moduleId], failed).map(mistake => mistake.questionId), second.map(question => question.id), 'Mistakes stay attached to the earlier attempt');
  const afterRefreshReview = createMockReview({ lesson: state.lessons[lesson.moduleId], result: failed });
  equal(afterRefreshReview, latestReview, 'Review reasoning is unchanged when active questions change');

  let providerPayload;
  const route = load('app/api/review/route.ts', { '@/lib/claude-lesson': { requestClaudeJson: async options => { providerPayload = options.payload; return null; } } }, new Map());
  const response = await route.POST(new Request('http://localhost/api/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lesson: state.lessons[lesson.moduleId], result: failed }),
  }));
  equal(response.status, 200, 'The review endpoint accepts a valid historical question snapshot');
  equal(providerPayload.lesson.quiz, second, 'The provider receives the scored questions instead of the new active quiz');
  equal(providerPayload.mistakes.map(item => item.question.id), second.map(question => question.id), 'Provider mistake lookup uses the scored question snapshot');

  const restored = restoreForTest(JSON.stringify(state));
  equal(restored.lessons[lesson.moduleId].quiz, third, 'The new unattempted quiz survives reload');
  equal(restored.quizResults[lesson.moduleId], passed, 'Best score and its question set survive reload');
  equal(restored.latestQuizResults[lesson.moduleId], failed, 'The preceding failed question set survives reload for diagnostics');
  equal(restored.quizHistory[lesson.moduleId].length, 3, 'Reload keeps distinct attempt history');
  equal(restored.remediations[lesson.moduleId].review, latestReview.review, 'The review restores against its own old questions');
  equal(restored.plan.modules[0].status, 'completed', 'Reload preserves completion across question variants');

  const before = clone(current().state);
  current().recordQuizResult(passed, plan.id, 'quiz-generation-one');
  equal(current().state, before, 'An old question set cannot be submitted after refresh');
  const altered = attempt(lesson, third, third.length, 3);
  altered.questions[0].question = 'A stale question with a reused ID';
  current().recordQuizResult(altered, plan.id, 'quiz-generation-one');
  equal(current().state, before, 'Matching IDs alone cannot disguise changed question content');
  current().replaceQuiz(lesson.id, lesson.moduleId, first, 'another-plan', 'quiz-generation-one');
  equal(current().state, before, 'A late response for another plan cannot replace questions');
  current().replaceQuiz(lesson.id, lesson.moduleId, first, plan.id, 'old-generation');
  equal(current().state, before, 'A late response for an old plan generation cannot replace questions');
  current().replaceQuiz('old-lesson', lesson.moduleId, first, plan.id, 'quiz-generation-one');
  equal(current().state, before, 'A late response for another lesson cannot replace questions');
  current().replaceQuiz(lesson.id, lesson.moduleId, [{ invalid: true }], plan.id, 'quiz-generation-one');
  equal(current().state, before, 'Malformed generated questions cannot corrupt the active lesson');

  const countedQuestions = (count, prefix) => Array.from({ length: count }, (_, index) => ({
    ...clone(lesson.quiz[index % lesson.quiz.length]),
    id: `${prefix}-${index}`, question: `${prefix} application ${index + 1}: ${lesson.quiz[index % lesson.quiz.length].question}`,
  }));
  const five = countedQuestions(5, 'five');
  const ten = countedQuestions(10, 'ten');
  const fiveLesson = { ...lesson, quiz: five };
  const counted = harness({ ...initial, lessons: { [lesson.moduleId]: fiveLesson } });
  const fiveFailure = attempt(fiveLesson, five, 2, 10);
  counted().recordQuizResult(fiveFailure, plan.id, 'quiz-generation-one');
  const fiveReview = createMockReview({ lesson: fiveLesson, result: fiveFailure });
  counted().saveRemediation(fiveReview, plan.id, 'quiz-generation-one', fiveFailure);
  counted().replaceQuiz(lesson.id, lesson.moduleId, ten, plan.id, 'quiz-generation-one');
  const tenState = counted().state;
  equal(tenState.lessons[lesson.moduleId].quiz, ten, 'Changing from five to ten questions saves the complete new set');
  equal(tenState.quizResults[lesson.moduleId].questions, five, 'Best result retains its five-question snapshot after a count change');
  equal(tenState.latestQuizResults[lesson.moduleId].questions, five, 'Latest result retains its five-question snapshot after a count change');
  equal(tenState.quizHistory[lesson.moduleId][0].questions, five, 'History retains the original question count and content');
  assertReviewResponse(fiveReview, tenState.lessons[lesson.moduleId], fiveFailure); assertions++;
  equal(createMockReview({ lesson: tenState.lessons[lesson.moduleId], result: fiveFailure }), fiveReview,
    'A five-question review remains grounded after switching to ten questions');
  const restoredTen = restoreForTest(JSON.stringify(tenState));
  equal(restoredTen.lessons[lesson.moduleId].quiz, ten, 'Reload keeps the ten-question active quiz');
  equal(restoredTen.latestQuizResults[lesson.moduleId], fiveFailure, 'Reload preserves the preceding five-question attempt');
  equal(restoredTen.remediations[lesson.moduleId].review, fiveReview.review, 'Reload restores the old five-question review against its snapshot');
  counted().recordQuizResult(fiveFailure, plan.id, 'quiz-generation-one');
  equal(counted().state, tenState, 'A stale five-question submission is rejected while ten questions are active');
  const seventy = attempt(lesson, ten, 7, 11);
  counted().recordQuizResult(seventy, plan.id, 'quiz-generation-one');
  equal(counted().state.quizResults[lesson.moduleId].score, 70, 'Seven correct answers out of ten score exactly seventy percent');
  equal(counted().state.plan.modules[0].status, 'completed', 'Exactly seventy percent completes the module');
  equal(counted().state.plan.modules[1].status, 'not-started', 'A seventy-percent pass unlocks the successor');
  const nextFive = countedQuestions(5, 'later-five');
  counted().replaceQuiz(lesson.id, lesson.moduleId, nextFive, plan.id, 'quiz-generation-one');
  const laterFiveFailure = attempt(lesson, nextFive, 3, 12);
  counted().recordQuizResult(laterFiveFailure, plan.id, 'quiz-generation-one');
  equal(counted().state.quizResults[lesson.moduleId], seventy, 'A later failed five-question attempt preserves the seventy-percent ten-question best');
  equal(counted().state.latestQuizResults[lesson.moduleId], laterFiveFailure, 'Latest diagnostics follow the later five-question attempt');
  equal(counted().state.plan.modules[0].status, 'completed', 'A later count change and failure cannot undo completion');
  equal(counted().state.plan.modules[1].status, 'not-started', 'A later failed five-question attempt cannot relock the successor');

  for (const corrupt of [
    value => { value.questions[1].id = value.questions[0].id; },
    value => { value.questions.pop(); },
    value => { value.questions[0].correctAnswer = 9; },
    value => { value.answers[value.questions[0].id] = 5; },
    value => { value.questions[0].correctAnswer = (value.questions[0].correctAnswer + 1) % 4; },
  ]) {
    const result = clone(passed); corrupt(result);
    rejects(() => assertQuizResult(result), 'Malformed question snapshots fail runtime validation');
  }
  const broken = clone(state);
  broken.latestQuizResults[lesson.moduleId].questions[1].id = broken.latestQuizResults[lesson.moduleId].questions[0].id;
  broken.quizResults[lesson.moduleId].questions = [];
  const recovered = restoreForTest(JSON.stringify(broken));
  equal(recovered.profile, profile, 'Malformed optional quiz snapshots cannot erase the learner profile');
  equal(recovered.quizResults[lesson.moduleId], passed, 'Valid historical best score recovers when optional current records are malformed');
  equal(recovered.latestQuizResults, {}, 'Malformed current snapshot is evicted independently');
  const bestOnly = clone(state);
  bestOnly.quizHistory = {};
  bestOnly.latestQuizResults = {};
  bestOnly.quizResults[lesson.moduleId].questions = [];
  const recoveredBest = restoreForTest(JSON.stringify(bestOnly));
  equal(recoveredBest.quizResults[lesson.moduleId].score, 100, 'A corrupt optional snapshot cannot erase the only saved best passing grade');
  equal(recoveredBest.quizResults[lesson.moduleId].answers, undefined, 'Recovered historical score does not invent per-question diagnostics');
  equal(recoveredBest.plan.modules[0].status, 'completed', 'A recovered grade retains completed progress');

  const legacyStore = { version: 1, profile, plan, lessons: { [lesson.moduleId]: lesson }, quizResults: { [lesson.moduleId]: legacyFailure } };
  equal(restoreForTest(JSON.stringify(legacyStore)).latestQuizResults[lesson.moduleId], legacyFailure, 'Legacy score-only stores continue to migrate');
  const locked = clone(initial); locked.plan.modules[0].status = 'locked';
  const lockedCurrent = harness(locked);
  lockedCurrent().replaceQuiz(lesson.id, lesson.moduleId, first, plan.id, 'quiz-generation-one');
  equal(lockedCurrent().state.lessons[lesson.moduleId].quiz, lesson.quiz, 'Locked modules cannot obtain replacement questions');
  console.log(`PASS ${assertions} quiz history assertions: fresh sets, snapshots, review grounding, reload, prior progress, stale responses, and legacy migration.`);
  console.log('Provider transport was stubbed; no credentials or live API calls were used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
