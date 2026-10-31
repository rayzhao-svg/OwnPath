/* eslint-disable @typescript-eslint/no-require-imports */
/** Teaching upgrades must never replace an assessment or discard earned progress. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (value, label) => { assert.ok(value, label); assertions++; };
const clone = value => JSON.parse(JSON.stringify(value));
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };

function load(relative, overrides = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  let code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  if (relative === 'lib/learning-context.tsx') code += '\nexports.restoreForTest = restoreState;';
  const requireLocal = name => {
    if (name in overrides) return overrides[name];
    if (name === 'server-only') return {};
    if (name === 'react/jsx-runtime') return jsx;
    if (name.startsWith('@/')) {
      const target = ['.ts', '.tsx'].map(extension => name.slice(2) + extension)
        .find(candidate => fs.existsSync(path.join(root, candidate)));
      if (!target) throw new Error(`Missing import ${name}`);
      return load(target, overrides, cache);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', code)(requireLocal, item, item.exports);
  return item.exports;
}

function hooks(runEffects = false) {
  const slots = []; let index = 0, effects = [];
  return {
    react: {
      createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
      useState(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
      },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useCallback(callback, dependencies) {
        const slot = index++, previous = slots[slot];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) slots[slot] = { callback, dependencies };
        return slots[slot].callback;
      },
      useEffect(effect, dependencies) {
        const slot = index++, previous = slots[slot];
        if (runEffects && (!previous || !dependencies || dependencies.some((value, i) => value !== previous.dependencies[i])))
          effects.push(() => { previous?.cleanup?.(); slots[slot] = { dependencies, effect, cleanup: effect() }; });
      },
    },
    render(component) {
      index = 0;
      const tree = component(), pending = effects;
      effects = []; pending.forEach(run => run());
      return tree;
    },
    replayEffects() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).trim() === label);
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function detailedSlide(slide, heavy = false) {
  const roles = ['concept', 'reasoning', 'worked-example', 'pitfall', 'guided-practice', 'independent-practice', 'recap'];
  const scenes = roles.map((role, section) => {
    const lineNarrations = Array.from({ length: heavy ? 8 : 3 }, (_, index) =>
      `${role} step ${index + 1}: explain ${slide.bullets[0]} Compare the intermediate customer counts before applying the calculation, and check the result against the original observation window.`.padEnd(heavy ? 350 : 220, 'x'));
    return {
      title: `Customer teaching section ${section + 1}`, role, lineNarrations,
      narration: lineNarrations.join(' '),
      visual: { kind: section === 2 ? 'calculation' : 'concept', lines: lineNarrations.map((_, index) =>
        `Customer evidence step ${index + 1}: 8 retained / 10 original = 80 percent.`.padEnd(heavy ? 350 : 100, 'x')) },
    };
  });
  return { ...clone(slide), overview: slide.overview ?? slide.narration, learningObjective: slide.learningObjective ?? slide.bullets[0],
    teachingVersion: 2, qualityVersion: 1, scenes, narration: scenes.map(scene => scene.narration).join(' ') };
}
function detailed(lesson) {
  return { ...clone(lesson), slides: lesson.slides.map(slide => detailedSlide(slide)) };
}
function chapterPatch(request) {
  return { lessonId: request.lesson.id, moduleId: request.lesson.moduleId,
    slide: detailedSlide(request.lesson.slides.find(slide => slide.id === request.slideId)), mode: 'claude' };
}
function storageOverflow(lesson) {
  const { MAX_STORED_LESSON_BYTES } = load('lib/lesson-budget.ts');
  const source = { ...clone(lesson), slides: Array.from({ length: 12 }, (_, index) => ({ ...clone(lesson.slides[0]), id: `storage-chapter-${index}`, title: `Customer evidence chapter ${index + 1}` })) };
  const target = detailedSlide(source.slides[0], true);
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for (let index = 1; index < source.slides.length; index++) {
    source.slides[index] = detailedSlide(source.slides[index], true);
    const expanded = { ...source, slides: source.slides.map((slide, position) => position === 0 ? target : slide) };
    if (bytes(source) <= MAX_STORED_LESSON_BYTES && bytes(expanded) > MAX_STORED_LESSON_BYTES)
      return { source, expanded, target };
  }
  throw new Error('The storage fixture must cross the explicit per-course ceiling');
}
function quiz(lesson, count, prefix) {
  return Array.from({ length: count }, (_, index) => ({ ...clone(lesson.quiz[index % lesson.quiz.length]), id: `${prefix}-${index}` }));
}
function budgetFixtures(lesson) {
  const questions = quiz(lesson, 10, 'large-budget').map((question, index) => ({
    ...question, question: `Customer analysis scenario ${index}: `.padEnd(490, 'x'),
    options: ['A', 'B', 'C', 'D'].map(value => `${value}: customer evidence `.padEnd(240, value)),
    explanation: 'Compare customer evidence before applying the calculation. '.padEnd(650, 'x'),
  }));
  const expanded = { ...clone(lesson), slides: lesson.slides.map(slide => {
    const scenes = Array.from({ length: 4 }, (_, index) => ({
      title: `Worked customer step ${index + 1}`,
      narration: 'Explain the customer calculation and check the intermediate result. '.padEnd(590, 'x'),
      visual: { kind: 'calculation', lines: ['Customer input '.padEnd(220, 'x'), 'Customer result '.padEnd(220, 'x')] },
    }));
    return { ...clone(slide), scenes, narration: scenes.map(scene => scene.narration).join(' ') };
  }) };
  return { questions, expanded };
}
function attempt(lesson, correctCount) {
  const answers = Object.fromEntries(lesson.quiz.map((question, index) => [question.id,
    index < correctCount ? question.correctAnswer : (question.correctAnswer + 1) % question.options.length]));
  const score = Math.round(correctCount / lesson.quiz.length * 100);
  return { lessonId: lesson.id, moduleId: lesson.moduleId, correctAnswers: correctCount, totalQuestions: lesson.quiz.length,
    score, passed: score >= 70, answers, questions: clone(lesson.quiz), completedAt: '2026-10-31T18:00:00.000Z',
    missedQuestionIds: lesson.quiz.filter(question => answers[question.id] !== question.correctAnswer).map(question => question.id) };
}

async function stateChecks(initial, lesson, plan) {
  const runtime = hooks();
  const { LearningProvider, restoreForTest } = load('lib/learning-context.tsx', { react: runtime.react });
  const current = () => runtime.render(() => LearningProvider({ children: null })).props.value;
  current().setPlan(initial.profile, plan, 'claude');
  current().saveLesson(lesson, 'claude', plan.id, current().state.planGeneration);
  const generation = current().state.planGeneration;
  const result = attempt(lesson, 3);
  current().recordQuizResult(result, plan.id, generation);
  const { createMockReview, assertReviewResponse } = load('lib/remediation.ts');
  const review = createMockReview({ lesson, result });
  current().saveRemediation(review, plan.id, generation, result);
  current().markRemediationReviewed(lesson.moduleId, result.completedAt);
  const before = clone(current().state), expanded = detailed(lesson);

  // A quiz refresh can finish while the older lesson's detail request is pending.
  const ten = quiz(lesson, 10, 'concurrent-ten');
  current().replaceQuiz(lesson.id, lesson.moduleId, ten, plan.id, generation);
  const beforeTeaching = clone(current().state);
  current().updateLessonTeaching(expanded, 'claude', plan.id, generation);
  let state = current().state;
  equal(state.lessons[lesson.moduleId].quiz, ten, 'Teaching upgrades preserve a concurrently replaced ten-question quiz');
  equal(state.lessons[lesson.moduleId].slides, expanded.slides, 'Expanded scene narration is saved without changing slide membership');
  equal(state.quizResults, before.quizResults, 'Best grades survive a teaching upgrade');
  equal(state.latestQuizResults, before.latestQuizResults, 'Latest diagnostics survive a teaching upgrade');
  equal(state.quizHistory, before.quizHistory, 'Attempt history survives a teaching upgrade');
  equal(state.remediations, before.remediations, 'Saved and reviewed remediation survives a teaching upgrade');
  equal(state.plan, beforeTeaching.plan, 'Expanding an explanation does not change completion or prerequisites');
  equal(state.planGeneration, generation, 'Expanding a lesson retains the plan generation guard');
  equal(state.lessons[lesson.moduleId].id, lesson.id, 'Expanding a lesson retains its identity');
  assertReviewResponse(state.remediations[lesson.moduleId], state.lessons[lesson.moduleId], result); assertions++;

  expanded.slides[0].scenes[0].visual.lines[0] = 'Caller changed its response after saving';
  check(state.lessons[lesson.moduleId].slides[0].scenes[0].visual.lines[0] !== expanded.slides[0].scenes[0].visual.lines[0], 'Saved teaching visuals do not alias a mutable caller response');
  state = clone(current().state);
  for (const [change, planId, planGeneration] of [
    [value => { value.id = 'stale-lesson'; }, plan.id, generation],
    [value => { value.slides.reverse(); }, plan.id, generation],
    [value => { value.slides[0].title = 'A replacement chapter'; }, plan.id, generation],
    [value => { value.slides[0].bullets = ['Different source material']; }, plan.id, generation],
    [value => { value.slides[0].scenes[0].narration = 'Unmatched text'; }, plan.id, generation],
    [() => {}, 'stale-plan', generation],
    [() => {}, plan.id, 'stale-generation'],
  ]) {
    const response = detailed(lesson); change(response);
    current().updateLessonTeaching(response, 'claude', planId, planGeneration);
    equal(current().state, state, 'Mismatched or stale teaching cannot replace the saved lesson');
  }
  const restored = restoreForTest(JSON.stringify(state));
  equal(restored.lessons[lesson.moduleId].slides, state.lessons[lesson.moduleId].slides, 'Teaching scenes and their narration survive reload');
  check(restored.lessons[lesson.moduleId].slides.every(slide => slide.qualityVersion === 1), 'Reviewed teaching retains its quality marker across persistence');
  equal(restored.lessons[lesson.moduleId].quiz, ten, 'The concurrently refreshed assessment survives reload');
  equal(restored.quizResults, state.quizResults, 'Prior scores survive reload with expanded teaching');
  equal(restored.remediations, state.remediations, 'Historical targeted reviews remain valid after reload');

  const passed = attempt(current().state.lessons[lesson.moduleId], ten.length);
  current().recordQuizResult(passed, plan.id, generation);
  const anotherExplanation = detailed(current().state.lessons[lesson.moduleId]);
  anotherExplanation.slides[0].scenes[0].lineNarrations[0] += ' Keep the intermediate values visible while checking your reasoning.';
  anotherExplanation.slides[0].scenes[0].narration = anotherExplanation.slides[0].scenes[0].lineNarrations.join(' ');
  anotherExplanation.slides[0].narration = anotherExplanation.slides[0].scenes.map(scene => scene.narration).join(' ');
  current().updateLessonTeaching(anotherExplanation, 'claude', plan.id, generation);
  equal(current().state.quizResults[lesson.moduleId], passed, 'A teaching change retains the earned passing assessment');
  equal(current().state.plan.modules[0].status, 'completed', 'A teaching change cannot undo module completion');
  equal(current().state.plan.modules[1].status, 'not-started', 'A teaching change cannot relock the unlocked successor');
}

function budgetStateChecks(initial, lesson, plan) {
  const { assertLessonRequestBudget, MAX_STORED_LESSON_BYTES } = load('lib/lesson-budget.ts');
  const { assertLesson } = load('lib/validators.ts');
  const { questions, expanded } = budgetFixtures(lesson);
  const combined = { ...expanded, quiz: questions };
  assertLesson(combined); assertLessonRequestBudget(combined); assertions += 2;
  check(new TextEncoder().encode(JSON.stringify(combined)).byteLength > 56 * 1024, 'The accepted course exceeds the former combined request budget');
  for (const order of ['teaching-first', 'quiz-first']) {
    const runtime = hooks();
    const { LearningProvider } = load('lib/learning-context.tsx', { react: runtime.react });
    const current = () => runtime.render(() => LearningProvider({ children: null })).props.value;
    current().setPlan(initial.profile, plan, 'claude');
    const generation = current().state.planGeneration;
    current().saveLesson(lesson, 'claude', plan.id, generation);
    const passed = attempt(lesson, lesson.quiz.length);
    current().recordQuizResult(passed, plan.id, generation);
    if (order === 'teaching-first') current().updateLessonTeaching(expanded, 'claude', plan.id, generation);
    else current().replaceQuiz(lesson.id, lesson.moduleId, questions, plan.id, generation);
    if (order === 'teaching-first') current().replaceQuiz(lesson.id, lesson.moduleId, questions, plan.id, generation);
    else current().updateLessonTeaching(expanded, 'claude', plan.id, generation);
    equal(current().state.lessons[lesson.moduleId].slides, expanded.slides, `${order}: large teaching remains saved alongside the refreshed assessment`);
    equal(current().state.lessons[lesson.moduleId].quiz, questions, `${order}: large teaching preserves the complete new quiz`);
    equal(current().state.quizResults[lesson.moduleId], passed, `${order}: course growth preserves the earned passing score`);
    equal(current().state.plan.modules[0].status, 'completed', `${order}: course growth preserves earned completion`);
  }
  const { source, expanded: overflow } = storageOverflow(lesson);
  assertLesson(source); assertLesson(overflow); assertLessonRequestBudget(source); assertions += 3;
  check(new TextEncoder().encode(JSON.stringify(overflow)).byteLength > MAX_STORED_LESSON_BYTES, 'The rejected fixture exceeds the actual 512-KiB storage ceiling');
  assert.throws(() => assertLessonRequestBudget(overflow), /too large to save/); assertions++;
  const runtime = hooks();
  const { LearningProvider } = load('lib/learning-context.tsx', { react: runtime.react });
  const current = () => runtime.render(() => LearningProvider({ children: null })).props.value;
  current().setPlan(initial.profile, plan, 'claude');
  const generation = current().state.planGeneration;
  current().saveLesson(source, 'claude', plan.id, generation);
  current().recordQuizResult(attempt(source, source.quiz.length), plan.id, generation);
  const before = clone(current().state);
  current().updateLessonTeaching(overflow, 'claude', plan.id, generation);
  equal(current().state, before, 'A true storage overflow preserves the exact cached chapters, questions, scores, and completion');
}

async function clientChecks(lesson, module) {
  const { requestChapterDetailResponse } = load('lib/api-client.ts');
  const originalFetch = global.fetch;
  const slideId = lesson.slides[0].id;
  const valid = { lessonId: lesson.id, moduleId: lesson.moduleId, slide: detailedSlide(lesson.slides[0]), mode: 'claude' };
  let calls = 0, captured;
  try {
    global.fetch = async (url, options) => { calls++; captured = { url, options }; return Response.json(valid); };
    equal(await requestChapterDetailResponse(lesson, module, slideId), valid, 'The client accepts a patch for the exact selected chapter');
    equal(captured.url, '/api/lesson/detail', 'The chapter client uses the bounded teaching endpoint');
    const body = JSON.parse(captured.options.body);
    equal(body.slideId, slideId, 'The detail request explicitly identifies one chapter');
    equal(body.lesson.slides.map(slide => [slide.id, slide.title, slide.bullets]), lesson.slides.map(slide => [slide.id, slide.title, slide.bullets]), 'The detail request retains the ordered course outline');
    check(body.lesson.slides.every(slide => !slide.scenes), 'A chapter request omits cached teaching scenes');
    equal(body.module, module, 'The chapter request retains its module context');
    for (const change of [
      value => { value.lessonId = 'other-lesson'; },
      value => { value.moduleId = 'other-module'; },
      value => { value.slide.id = 'other-chapter'; },
      value => { value.slide.title = 'Other title'; },
      value => { value.slide.bullets = ['Other bullets']; },
      value => { delete value.slide.scenes; },
      value => { delete value.slide.teachingVersion; },
      value => { delete value.slide.qualityVersion; },
      value => { value.slide.qualityVersion = 2; },
      value => { value.mode = 'unknown'; },
    ]) {
      const bad = clone(valid); change(bad);
      global.fetch = async () => Response.json(bad);
      await assert.rejects(requestChapterDetailResponse(lesson, module, slideId)); assertions++;
    }
    const before = calls;
    await assert.rejects(requestChapterDetailResponse({ ...lesson, title: 'x'.repeat(70 * 1024) }, module, slideId)); assertions++;
    equal(calls, before, 'An oversized fixed course outline is rejected before sending any data');
    const controller = new AbortController(); controller.abort();
    global.fetch = async (_url, options) => { check(options.signal.aborted, 'Caller cancellation reaches the combined chapter request signal'); throw new DOMException('Aborted', 'AbortError'); };
    await assert.rejects(requestChapterDetailResponse(lesson, module, slideId, controller.signal)); assertions++;
  } finally { global.fetch = originalFetch; }
}

function parentHarness(initial, lesson) {
  const runtime = hooks(true), requests = [], updates = [], quizRequests = [], replacements = [];
  const context = { ready: true, state: clone(initial), saveLesson() {}, startModule() {}, recordQuizResult() {}, saveRemediation() {}, markRemediationReviewed() {},
    replaceQuiz(...args) { replacements.push(args); const [, id, questions] = args; context.state = { ...context.state, lessons: { ...context.state.lessons, [id]: { ...context.state.lessons[id], quiz: questions } } }; },
    updateLessonTeaching(...args) { updates.push(args); const [expanded] = args; context.state = { ...context.state, lessons: { ...context.state.lessons, [expanded.moduleId]: expanded } }; } };
  const { LessonExperience } = load('components/lesson-experience.tsx', {
    react: runtime.react, 'next/link': 'a', '@/app/learn/lesson.css': {},
    '@/components/app-shell': { AppShell: 'AppShell' }, '@/components/icon': { Icon: () => null },
    '@/components/lecture-chat': { LectureChat: 'LectureChat' }, '@/components/lecture-player': { LecturePlayer: 'LecturePlayer' }, '@/components/quiz': { Quiz: 'Quiz' },
    '@/lib/learning-context': { useLearning: () => context },
    '@/lib/api-client': { requestLessonResponse: () => { throw new Error('Cached lesson must not be regenerated'); },
      requestQuizRefreshResponse(saved, previousQuestions, count, signal) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); quizRequests.push({ lesson: saved, previousQuestions, count, signal, resolve, reject }); return promise; },
      requestChapterDetailResponse(saved, module, slideId, signal) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ lesson: saved, module, slideId, signal, resolve, reject }); return promise; } },
  });
  let tree, pauses = 0, moduleId = lesson.moduleId;
  const render = () => { tree = runtime.render(() => LessonExperience({ moduleId })); const player = find(tree, node => node.type === 'LecturePlayer'); if (player) player.props.pauseNarrationRef.current = () => { pauses++; }; return tree; };
  render();
  return { context, requests, updates, quizRequests, replacements, render, replayEffects: () => runtime.replayEffects(), unmount: () => runtime.unmount(),
    navigate(id) { moduleId = id; return render(); }, chapter(index) { find(tree, node => node.type === 'LecturePlayer').props.onSlideChange(index); return render(); }, get tree() { return tree; }, get pauses() { return pauses; } };
}

async function parentChecks(initial, lesson) {
  const settleRender = async harness => { await settle(); harness.render(); await settle(); harness.render(); };
  const success = parentHarness(initial, lesson);
  success.replayEffects(); await settleRender(success);
  equal(success.requests.length, 1, 'Strict Mode replay starts only one active-chapter request');
  equal(success.requests[0].slideId, lesson.slides[0].id, 'The visible chapter is prepared before any later chapter');
  check(text(success.tree).includes('Preparing this chapter'), 'The existing course shows nonblocking chapter preparation');
  check(find(success.tree, node => node.type === 'LecturePlayer'), 'The existing player stays available while teaching loads');
  success.render(); await settle();
  equal(success.requests.length, 1, 'Ordinary renders do not duplicate a pending chapter request');
  const concurrentQuiz = quiz(lesson, 10, 'parent-concurrent');
  success.context.state.lessons[lesson.moduleId] = { ...success.context.state.lessons[lesson.moduleId], quiz: concurrentQuiz };
  success.render();
  success.requests[0].resolve(chapterPatch(success.requests[0])); await settleRender(success);
  equal(success.updates.length, 1, 'A valid chapter patch updates teaching exactly once');
  equal(success.updates[0].slice(1), ['claude', initial.plan.id, initial.planGeneration], 'The parent passes plan identity and generation guards');
  equal(success.context.state.lessons[lesson.moduleId].slides[0], chapterPatch(success.requests[0]).slide, 'The target chapter receives its complete teaching patch');
  equal(success.context.state.lessons[lesson.moduleId].slides[0].qualityVersion, 1, 'The verified patch quality marker is saved with its teaching');
  equal(success.context.state.lessons[lesson.moduleId].slides.slice(1), lesson.slides.slice(1), 'A chapter patch leaves every other chapter unchanged');
  equal(success.context.state.lessons[lesson.moduleId].quiz, concurrentQuiz, 'A chapter patch preserves questions changed while its request was pending');
  equal(success.pauses, 1, 'Replacing the visible chapter pauses its current narration once');
  equal(success.requests.length, 2, 'Completing the active chapter starts just one chapter ahead');
  equal(success.requests[1].slideId, lesson.slides[1].id, 'Prefetch prepares the next chapter in course order');
  success.requests[1].resolve(chapterPatch(success.requests[1])); await settleRender(success);
  equal(success.updates.length, 2, 'The next chapter patch is saved independently');
  equal(success.pauses, 1, 'An unrelated prefetched chapter never pauses the visible chapter');
  equal(success.requests.length, 2, 'Prefetch stops after one chapter ahead instead of generating the whole course');
  success.chapter(1); await settleRender(success);
  equal(success.requests.length, 3, 'Visiting a ready chapter prepares its own next chapter');
  equal(success.requests[2].slideId, lesson.slides[2].id, 'The prefetch window advances one chapter with navigation');
  success.unmount();
  check(success.requests[2].signal.aborted, 'Leaving the course cancels pending prefetch');

  const unreviewed = detailed(lesson);
  unreviewed.slides.forEach(slide => { delete slide.qualityVersion; });
  const qualityUpgrade = parentHarness({ ...clone(initial), lessons: { [lesson.moduleId]: unreviewed } }, unreviewed);
  await settleRender(qualityUpgrade);
  equal(qualityUpgrade.requests.length, 1, 'Previously expanded chapters without a quality review receive a fresh verified chapter');
  equal(qualityUpgrade.requests[0].slideId, lesson.slides[0].id, 'Quality upgrades prioritize the visible chapter');
  qualityUpgrade.requests[0].resolve(chapterPatch(qualityUpgrade.requests[0])); await settleRender(qualityUpgrade);
  equal(qualityUpgrade.context.state.lessons[lesson.moduleId].slides[0].qualityVersion, 1, 'The verified replacement completes the visible chapter quality upgrade');
  equal(qualityUpgrade.context.state.lessons[lesson.moduleId].quiz, lesson.quiz, 'A quality upgrade preserves the exact saved assessment');
  qualityUpgrade.unmount();

  const failure = parentHarness(initial, lesson); await settleRender(failure);
  failure.requests[0].reject(new Error('Expanded teaching is temporarily unavailable.')); await settleRender(failure);
  equal(failure.updates.length, 0, 'Failed chapter generation leaves the saved course untouched');
  check(text(failure.tree).includes('Expanded teaching is temporarily unavailable.'), 'A failed chapter shows an explicit retryable explanation');
  failure.render(); await settle();
  equal(failure.requests.length, 1, 'A failure does not create an automatic retry loop');
  button(failure.tree, 'Retry expanded explanation').props.onClick(); failure.render();
  equal(failure.requests.length, 2, 'The learner can explicitly retry the failed chapter');
  failure.unmount();
  check(failure.requests[1].signal.aborted, 'Unmount aborts a foreground chapter request');
  failure.requests[1].resolve(chapterPatch(failure.requests[1])); await settle();
  equal(failure.updates.length, 0, 'A chapter response arriving after unmount cannot restore teaching');

  const chapterNavigation = parentHarness(initial, lesson); await settleRender(chapterNavigation);
  chapterNavigation.chapter(3); await settleRender(chapterNavigation);
  equal(chapterNavigation.requests.length, 2, 'Jumping to another chapter prioritizes the newly visible chapter');
  equal(chapterNavigation.requests[1].slideId, lesson.slides[3].id, 'A chapter jump fetches its selected content rather than intermediate chapters');
  check(chapterNavigation.requests[0].signal.aborted, 'Chapter navigation cancels the previous foreground request');
  chapterNavigation.requests[0].resolve(chapterPatch(chapterNavigation.requests[0])); await settleRender(chapterNavigation);
  equal(chapterNavigation.updates.length, 0, 'A canceled earlier chapter patch is ignored');
  chapterNavigation.requests[1].resolve(chapterPatch(chapterNavigation.requests[1])); await settleRender(chapterNavigation);
  equal(chapterNavigation.context.state.lessons[lesson.moduleId].slides[3].teachingVersion, 2, 'The newly selected chapter still receives its teaching');
  chapterNavigation.unmount();

  const navigation = parentHarness(initial, lesson); await settleRender(navigation);
  const secondModule = { ...clone(initial.plan.modules[1]), status: 'not-started', prerequisites: [] };
  const secondLesson = { ...clone(lesson), id: 'second-lesson', moduleId: secondModule.id, title: secondModule.title };
  navigation.context.state.plan.modules[1] = secondModule;
  navigation.context.state.lessons[secondModule.id] = secondLesson;
  navigation.navigate(secondModule.id); await settleRender(navigation);
  equal(navigation.requests.length, 2, 'Another module receives a separate active-chapter request');
  check(navigation.requests[0].signal.aborted, 'Module navigation cancels the previous chapter request');
  navigation.requests[0].resolve(chapterPatch(navigation.requests[0])); await settleRender(navigation);
  equal(navigation.updates.length, 0, 'A previous module response cannot update the new module');
  check(text(navigation.tree).includes('Preparing this chapter'), 'An old response cannot clear the new chapter loading state');
  navigation.requests[1].resolve(chapterPatch(navigation.requests[1])); await settleRender(navigation);
  equal(navigation.updates[0][0].moduleId, secondModule.id, 'The new module response still applies after the old request settles');
  navigation.unmount();

  const { source, target } = storageOverflow(lesson);
  const overflow = parentHarness({ ...clone(initial), lessons: { [lesson.moduleId]: source } }, source); await settleRender(overflow);
  overflow.requests[0].resolve({ lessonId: lesson.id, moduleId: lesson.moduleId, slide: target, mode: 'claude' }); await settleRender(overflow);
  equal(overflow.updates.length, 0, 'The parent rejects a chapter merge above the actual storage ceiling');
  check(text(overflow.tree).includes('too large to save'), 'A true storage overflow shows an actionable error instead of success');
  check(button(overflow.tree, 'Retry expanded explanation'), 'A rejected chapter merge retains its explicit retry action');
  overflow.unmount();

  const serialized = parentHarness(initial, lesson);
  find(serialized.tree, node => node.type === 'Quiz').props.onRetry(); await settleRender(serialized);
  equal(serialized.quizRequests.length, 1, 'A quiz can start before automatic chapter preparation');
  equal(serialized.requests.length, 0, 'Chapter preparation waits while a requested quiz is running');
  serialized.quizRequests[0].reject(new Error('Questions temporarily unavailable.')); await settleRender(serialized);
  equal(serialized.requests.length, 1, 'Chapter preparation resumes after a failed quiz releases its guard');
  const available = find(serialized.tree, node => node.type === 'Quiz');
  check(!available.props.generationBlocked && !available.props.retryBusy, 'Optional chapter preparation leaves quiz generation available');
  available.props.onRetry(); available.props.onRetry(); serialized.render();
  equal(serialized.quizRequests.length, 2, 'One quiz click preempts chapter work, and repeated clicks remain deduplicated');
  check(serialized.requests[0].signal.aborted, 'Starting a quiz cancels the optional chapter generation');
  serialized.requests[0].resolve(chapterPatch(serialized.requests[0])); await settleRender(serialized);
  equal(serialized.updates.length, 0, 'The canceled chapter response cannot overwrite the pending quiz');
  equal(serialized.requests.length, 1, 'Chapter generation stays suspended while the quiz is pending');
  const priorityQuestions = quiz(lesson, 5, 'priority-quiz');
  serialized.quizRequests[1].resolve({ lessonId: lesson.id, moduleId: lesson.moduleId, quiz: priorityQuestions, mode: 'claude' });
  await settleRender(serialized);
  equal(serialized.replacements.length, 1, 'The requested quiz saves without another click');
  equal(serialized.requests.length, 2, 'Chapter preparation resumes after quiz completion');
  equal(serialized.requests[1].lesson.quiz, priorityQuestions, 'Resumed chapter preparation sees the newest saved questions');
  serialized.requests[1].resolve(chapterPatch(serialized.requests[1])); await settleRender(serialized);
  equal(serialized.context.state.lessons[lesson.moduleId].quiz, priorityQuestions, 'Resumed chapter teaching preserves the newly generated quiz');
  serialized.unmount();

  const readyLesson = detailed(lesson), readyState = { ...clone(initial), lessons: { [lesson.moduleId]: readyLesson } };
  const largeQuiz = parentHarness(readyState, readyLesson); await settleRender(largeQuiz);
  equal(largeQuiz.requests.length, 0, 'An entirely prepared course starts no redundant chapter requests');
  const originalKey = find(largeQuiz.tree, node => node.type === 'Quiz').key;
  const { questions, expanded } = budgetFixtures(lesson);
  find(largeQuiz.tree, node => node.type === 'Quiz').props.onRetry(); largeQuiz.render();
  largeQuiz.context.state.lessons[lesson.moduleId] = expanded; largeQuiz.render();
  largeQuiz.quizRequests[0].resolve({ lessonId: lesson.id, moduleId: lesson.moduleId, quiz: questions, mode: 'claude' }); await settleRender(largeQuiz);
  equal(largeQuiz.replacements.length, 1, 'A large stored course accepts a fresh assessment beyond the former request-size ceiling');
  const replaced = find(largeQuiz.tree, node => node.type === 'Quiz');
  check(replaced.key !== originalKey && !replaced.props.retryError, 'Successful assessment replacement resets answers only after saving');
  equal(largeQuiz.context.state.lessons[lesson.moduleId].slides, expanded.slides, 'Generating questions preserves every latest saved chapter');
  largeQuiz.unmount();
}

(async () => {
  const profile = { id: 'detail-state-learner', name: 'Alex', background: 'Business studies', experience: '', skills: ['Spreadsheets'], goals: 'Analyze customer data', availableStudyTime: 5, track: 'data-science' };
  const { createMockPlan } = load('lib/mock-data.ts');
  const { generateLesson } = load('lib/ai.ts');
  const plan = createMockPlan(profile), original = (await generateLesson({ module: plan.modules[0] })).lesson;
  const lesson = { ...original, slides: Array.from({ length: 8 }, (_, index) => ({ ...clone(original.slides[index % original.slides.length]), id: `course-outline-${index}`, title: `Customer analysis chapter ${index + 1}` })), quiz: quiz(original, 5, 'detail-five') };
  const initial = { version: 1, profile, plan, lessons: { [lesson.moduleId]: lesson }, quizResults: {}, latestQuizResults: {}, quizHistory: {}, remediations: {}, lessonModes: { [lesson.moduleId]: 'claude' }, planGeneration: 'detail-generation-one' };
  await stateChecks(initial, lesson, plan);
  budgetStateChecks(initial, lesson, plan);
  await clientChecks(lesson, plan.modules[0]);
  const priorDocument = global.document, priorFrame = global.requestAnimationFrame;
  try {
    global.document = { getElementById: () => ({ scrollIntoView() {} }) };
    global.requestAnimationFrame = callback => { callback(); return 0; };
    await parentChecks(initial, lesson);
  } finally {
    if (priorDocument === undefined) delete global.document; else global.document = priorDocument;
    if (priorFrame === undefined) delete global.requestAnimationFrame; else global.requestAnimationFrame = priorFrame;
  }
  console.log(`PASS ${assertions} lesson detail state/client/parent assertions: concurrent quizzes, progress and review preservation, response identity, reload, deduplication, explicit retry, and cancellation.`);
  console.log('All provider and audio transport was stubbed; no live requests or credentials were used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
