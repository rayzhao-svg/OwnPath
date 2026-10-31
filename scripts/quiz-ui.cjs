/* eslint-disable @typescript-eslint/no-require-imports */
/** Quiz refresh regressions exercise actual component handlers without provider calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };

function load(relative, overrides, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireLocal = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('@/')) {
      const target = ['.ts', '.tsx'].map(extension => name.slice(2) + extension)
        .find(candidate => fs.existsSync(path.join(root, candidate)));
      if (!target) throw new Error(`Missing local import ${name}`);
      return load(target, overrides, cache);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', output)(requireLocal, item, item.exports);
  return item.exports;
}

function hooks() {
  const slots = []; let index = 0, effects = [];
  return {
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
      },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useCallback(callback, dependencies) {
        const slot = index++, previous = slots[slot];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
          slots[slot] = { callback, dependencies };
        }
        return slots[slot].callback;
      },
      useEffect(effect, dependencies) {
        const slot = index++, previous = slots[slot];
        if (!previous || !dependencies || dependencies.some((value, i) => value !== previous.dependencies[i])) {
          effects.push(() => { previous?.cleanup?.(); slots[slot] = { dependencies, cleanup: effect() }; });
        }
      },
    },
    render(component) {
      index = 0;
      const tree = component();
      const pending = effects; effects = []; pending.forEach(run => run());
      return tree;
    },
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
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).trim().replace(/\s+/g, ' ') === label);
const clone = value => JSON.parse(JSON.stringify(value));

const original = {
  id: 'quiz-ui-lesson', moduleId: 'quiz-ui-module', title: 'Customer CSV analysis',
  slides: [
    { id: 'csv-types', title: 'CSV values and types', bullets: ['CSV values start as text.', 'Convert spend with float before arithmetic.'], narration: 'A CSV reader returns text. Use float(row.spend) before adding spending values.' },
    { id: 'csv-rows', title: 'Named row values', bullets: ['A dictionary associates field names with values.'], narration: 'Use a dictionary to connect a field name such as spend to its value.' },
    { id: 'csv-loops', title: 'Counting matching customers', bullets: ['Add one to the count for each spending value over the threshold.'], narration: 'For spending 120, 80 and 150, two customers are above 100.' },
  ],
  quiz: [
    { id: 'original-types', question: 'Why convert CSV spending values before arithmetic?', options: ['They start as text', 'It makes the file smaller', 'Dictionaries cannot contain numbers', 'Every value is missing'], correctAnswer: 0, explanation: 'CSV values start as text, so convert spending to a number before arithmetic.' },
    { id: 'original-rows', question: 'Which structure associates each field name with a value?', options: ['A boolean', 'One integer', 'A dictionary', 'A filename'], correctAnswer: 2, explanation: 'A dictionary pairs names such as spend with their row values.' },
    { id: 'original-count', question: 'How many of the values 120, 80 and 150 exceed 100?', options: ['0', '1', '3', '2'], correctAnswer: 3, explanation: '120 and 150 exceed 100. Counting each matching customer gives two.' },
    { id: 'original-repeat', question: 'Which structure repeats a calculation for every customer?', options: ['A filename', 'A for loop', 'A column title', 'A quoted string'], correctAnswer: 1, explanation: 'A for loop visits each customer row to repeat the calculation.' },
    { id: 'original-total', question: 'Which operation updates a running spending total?', options: ['Reset it for each row', 'Store the header', 'Add the current numeric spend', 'Count only missing cells'], correctAnswer: 2, explanation: 'Add each numeric spending value to the running total.' },
  ],
};
const refreshed = {
  ...clone(original),
  quiz: [
    { id: 'fresh-types', question: 'A spending column contains "45.5". Which step supports adding it to a total?', options: ['Add the field name instead', 'Convert it with float', 'Delete the customer row', 'Treat it as a boolean'], correctAnswer: 1, explanation: 'Convert the textual spending value with float before numeric addition.' },
    { id: 'fresh-rows', question: 'How can a named customer row provide the spend field directly?', options: ['Look up its dictionary field', 'Guess the file length', 'Use the number of headers as spending', 'Replace it with True'], correctAnswer: 0, explanation: 'A dictionary lets the program look up a value using its field name.' },
    { id: 'fresh-count', question: 'When a customer meets the spending threshold, what happens to the matching-customer count?', options: ['It resets to zero', 'It becomes the spending amount', 'It increases by one', 'It stores the filename'], correctAnswer: 2, explanation: 'Count one matching customer by increasing the counter by one.' },
    { id: 'fresh-repeat', question: 'How can the same spending calculation run for another row?', options: ['Use a loop over the rows', 'Rename the file extension', 'Delete the headers', 'Use one fixed customer value'], correctAnswer: 0, explanation: 'Loop over the rows to apply the calculation to every customer.' },
    { id: 'fresh-total', question: 'A numeric spend is 20 and the running total is 30. What is the updated total?', options: ['20', '30', '1', '50'], correctAnswer: 3, explanation: 'Add 20 to the previous total of 30 to obtain 50.' },
  ],
};

function attempt(lesson, choices) {
  const answers = Object.fromEntries(lesson.quiz.map((question, i) => [question.id, choices[i]]));
  const missed = lesson.quiz.filter(question => answers[question.id] !== question.correctAnswer);
  const correctAnswers = lesson.quiz.length - missed.length;
  const score = Math.round(100 * correctAnswers / lesson.quiz.length);
  return {
    lessonId: lesson.id, moduleId: lesson.moduleId, score, correctAnswers,
    totalQuestions: lesson.quiz.length, passed: score >= 70,
    completedAt: '2026-10-31T12:00:00.000Z', answers,
    missedQuestionIds: missed.map(question => question.id), questions: clone(lesson.quiz),
  };
}

function sizedLesson(count, prefix = 'sized') {
  return { ...clone(original), quiz: Array.from({ length: count }, (_, index) => ({
    ...clone(original.quiz[index % original.quiz.length]),
    id: `${prefix}-${index}`, question: `Customer scenario ${index + 1}: ${original.quiz[index % original.quiz.length].question}`,
  })) };
}

function harness(initial = {}) {
  const state = hooks(), completed = [], reviews = [], counts = []; let retries = 0;
  let props = {
    lesson: original,
    onComplete: result => completed.push(result),
    onReview: prompt => reviews.push(prompt),
    onRetry: () => { retries++; },
    onQuestionCountChange: count => { counts.push(count); props = { ...props, questionCount: count }; },
    ...initial,
  };
  const { Quiz } = load('components/quiz.tsx', {
    react: state.react, 'react/jsx-runtime': jsx,
    '@/components/icon': { Icon: () => null }, 'next/link': 'a',
  });
  let tree;
  const render = () => { tree = state.render(() => Quiz(props)); return tree; };
  const answer = choices => {
    props.lesson.quiz.forEach((question, i) => {
      const input = find(tree, node => node.type === 'input' && node.props.name === question.id && Number(node.props.value) === choices[i]);
      assert.ok(input, `Answer input exists for ${question.id}`);
      input.props.onChange(); render();
    });
  };
  const submit = () => { find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); };
  render();
  return {
    render, answer, submit, completed, reviews, counts,
    update(changes) { props = { ...props, ...changes }; return render(); },
    unmount: () => state.unmount(),
    get tree() { return tree; }, get retries() { return retries; },
  };
}

function run() {
  const first = harness();
  first.submit();
  equal(first.completed.length, 0, 'Unanswered questions cannot produce a quiz attempt');
  check(nodes(first.tree).some(node => node.props?.role === 'alert'), 'Missing answers have accessible feedback');
  first.answer([1, 0, 2, 0, 0]); first.submit();
  equal(first.completed[0].score, 0, 'The submitted choices determine the original quiz score');
  equal(first.completed[0].questions, original.quiz, 'Every attempt includes the actual questions used to grade it');
  equal(Object.keys(first.completed[0].answers).sort(), original.quiz.map(question => question.id).sort(), 'Recorded answers reference the original question IDs');
  first.submit();
  equal(first.completed.length, 1, 'Submitting an already scored form cannot duplicate the attempt');
  button(first.tree, 'Practice again').props.onClick(); first.render();
  equal(first.retries, 1, 'Practice again requests a new question set from its parent');
  equal(first.completed.length, 1, 'Requesting new questions does not create another scored attempt');
  check(text(first.tree).includes('You’re still making progress.'), 'The previous result stays visible until new questions arrive');
  equal(nodes(first.tree).filter(node => node.type === 'input' && node.props.checked).length, 5, 'Retry does not erase the previous answers before generation succeeds');

  first.update({ retryBusy: true });
  check(nodes(first.tree).some(node => node.props?.role === 'status' && /writing new questions/i.test(text(node))), 'Pending generation has accessible loading feedback');
  check(nodes(first.tree).filter(node => node.type === 'fieldset').every(node => node.props.disabled), 'Questions remain locked while replacement questions are pending');
  const pendingRetry = find(first.tree, node => node.type === 'button' && /practice again|new questions/i.test(text(node)));
  check(pendingRetry?.props.disabled, 'A pending quiz refresh disables another retry');
  check(find(first.tree, node => node.type === 'select').props.disabled, 'Question count cannot change during generation');

  first.update({ retryBusy: false, retryError: 'New questions could not load. Try again.' });
  check(nodes(first.tree).some(node => node.props?.role === 'alert' && text(node).includes('New questions could not load')), 'A refresh error is visible and accessible');
  check(text(first.tree).includes('You’re still making progress.'), 'A generation failure preserves the previous score');
  equal(nodes(first.tree).filter(node => node.type === 'input' && node.props.checked).length, 5, 'A generation failure preserves the previous answers');
  button(first.tree, 'Practice again').props.onClick();
  equal(first.retries, 2, 'A failed generation can be retried');
  first.unmount();

  const oldFailure = attempt(original, [1, 0, 2, 0, 0]);
  const next = harness({ lesson: refreshed, previousResult: oldFailure, latestResult: oldFailure });
  equal([...new Set(nodes(next.tree).filter(node => node.type === 'input').map(node => node.props.name))], refreshed.quiz.map(question => question.id), 'The remounted form renders the new question IDs');
  check(nodes(next.tree).filter(node => node.type === 'input').every(node => !node.props.checked), 'New questions start with no choices selected');
  check(!text(next.tree).includes(original.quiz[0].question), 'Old question stems are not shown as current practice questions');
  check(!text(next.tree).includes('Focus your next review'), 'Historical mistakes are not compared with the replacement questions');
  check(button(next.tree, 'Generate 5 questions'), 'Stored progress retains a way to request another fresh practice set');
  next.answer(refreshed.quiz.map(question => question.correctAnswer)); next.submit();
  equal(next.completed[0].score, 100, 'The replacement questions use their own answer key');
  equal(next.completed[0].questions, refreshed.quiz, 'The replacement attempt records its new question snapshot');
  equal(Object.keys(next.completed[0].answers).sort(), refreshed.quiz.map(question => question.id).sort(), 'Replacement answers do not retain any original question IDs');
  next.unmount();

  const earlierPass = attempt(original, original.quiz.map(question => question.correctAnswer));
  const practice = harness({ lesson: refreshed, previousResult: earlierPass });
  check(text(practice.tree).includes('already passed') && text(practice.tree).includes('100%'), 'The previous passing score remains visible before a fresh attempt');
  practice.answer(refreshed.quiz.map(question => (question.correctAnswer + 1) % question.options.length)); practice.submit();
  equal(practice.completed[0].passed, false, 'A failed fresh practice attempt is scored independently');
  check(/earlier passing score of\s*100\s*%\s*remains saved/.test(text(practice.tree)), 'A failed fresh attempt preserves the earlier passing-score message');
  practice.unmount();

  const pending = harness({ previousResult: earlierPass });
  pending.answer(original.quiz.map(question => question.correctAnswer));
  pending.update({ retryBusy: true }); pending.submit();
  equal(pending.completed.length, 0, 'An answered form cannot be scored while its replacement questions are loading');
  check(nodes(pending.tree).filter(node => node.type === 'fieldset').every(node => node.props.disabled), 'Loading a fresh set also locks an unsubmitted form');
  check(button(pending.tree, 'Check my understanding').props.disabled, 'The submit action is disabled during question generation');
  pending.unmount();

  const legacy = { ...oldFailure }; delete legacy.questions;
  const legacyView = harness({ latestResult: legacy });
  check(text(legacyView.tree).includes('Focus your next review'), 'A legacy result still supports review when its answers match the active quiz');
  legacyView.unmount();

  const setupLesson = { ...clone(original), quiz: clone(original.quiz.slice(0, 3)) };
  const setupResult = attempt(setupLesson, [1, 0, 2]);
  const setup = harness({ lesson: setupLesson, previousResult: setupResult, latestResult: setupResult });
  check(!find(setup.tree, node => node.type === 'form'), 'A legacy three-question lesson cannot submit a below-minimum assessment');
  equal(nodes(setup.tree).filter(node => node.type === 'input').length, 0, 'Legacy questions are hidden until a compliant set is generated');
  equal(find(setup.tree, node => node.type === 'select').props.value, 5, 'A legacy question set defaults the selector to five');
  check(text(setup.tree).includes('Your saved score is 0%'), 'Legacy setup preserves the earlier grade');
  button(setup.tree, 'Generate 5 questions').props.onClick();
  equal(setup.retries, 1, 'The legacy setup can request a compliant five-question assessment');
  setup.unmount();

  const selection = harness();
  const select = () => find(selection.tree, node => node.type === 'select');
  equal(nodes(select()).filter(node => node.type === 'option').map(node => node.props.value), [5, 6, 7, 8, 9, 10], 'The dropdown exposes only five through ten questions');
  selection.answer(original.quiz.map(question => question.correctAnswer));
  select().props.onChange({ target: { value: '7' } }); selection.render();
  equal(selection.counts, [7], 'Selecting seven updates the controlled question count');
  equal(selection.retries, 0, 'Changing the count alone does not generate a new quiz');
  equal(nodes(selection.tree).filter(node => node.type === 'input' && node.props.checked).length, 5, 'Changing the draft count preserves in-progress answers');
  check(button(selection.tree, 'Generate 7 questions'), 'The generation action reflects the selected count');
  for (const value of ['4', '11', '5.5', 'invalid']) select().props.onChange({ target: { value } });
  equal(selection.counts, [7], 'Invalid counts cannot leave the dropdown boundaries');
  button(selection.tree, 'Generate 7 questions').props.onClick();
  equal(selection.retries, 1, 'The explicit generation action requests the selected count');
  equal(nodes(selection.tree).filter(node => node.type === 'input' && node.props.checked).length, 5, 'Requesting a different count preserves answers until success');
  selection.unmount();

  const preparingDetails = harness({ generationBlocked: true });
  check(button(preparingDetails.tree, 'Generate 5 questions').props.disabled, 'Preparing lesson details disables only replacement generation');
  check(!button(preparingDetails.tree, 'Check my understanding').props.disabled, 'Current assessment submission remains enabled during teaching preparation');
  check(nodes(preparingDetails.tree).filter(node => node.type === 'fieldset').every(node => !node.props.disabled), 'Current answers remain editable while lesson details load');
  preparingDetails.answer(original.quiz.map(question => question.correctAnswer)); preparingDetails.submit();
  equal(preparingDetails.completed[0].score, 100, 'An existing quiz can still be graded while lesson details are pending');
  check(button(preparingDetails.tree, 'Practice again').props.disabled, 'A scored quiz waits for teaching preparation before generating its replacement');
  preparingDetails.unmount();

  for (const [count, correct, passed] of [[5, 3, false], [5, 4, true], [7, 5, true], [10, 6, false], [10, 7, true]]) {
    const lesson = sizedLesson(count, `boundary-${count}-${correct}`), boundary = harness({ lesson });
    equal(find(boundary.tree, node => node.type === 'select').props.value, count, `An active ${count}-question quiz sets its matching selector value`);
    boundary.answer(lesson.quiz.map((question, index) => index < correct ? question.correctAnswer : (question.correctAnswer + 1) % 4));
    boundary.submit();
    equal(boundary.completed[0].score, Math.round(correct / count * 100), `${correct} of ${count} is scored against the active question set`);
    equal(boundary.completed[0].passed, passed, `${correct} of ${count} honors the unchanged 70% threshold`);
    boundary.unmount();
  }
  console.log(`PASS ${assertions} quiz UI assertions: fresh retakes, pending/error preservation, question snapshots, remounting, scoring, and historical diagnostics.`);
  console.log('Actual component handlers were exercised; no network or provider calls were made.');
}

function parentHarness() {
  const state = hooks(), requests = [], replacements = [], reviewed = [], scrolls = [];
  const latest = attempt(original, [1, 0, 2, 0, 0]);
  const earlierLesson = {
    ...clone(original),
    quiz: original.quiz.map(question => ({ ...question, id: `earlier-${question.id}`, question: `Earlier exercise: ${question.question}` })),
  };
  const earlier = attempt(earlierLesson, [1, 0, 2, 0, 0]);
  const { createMockReview } = load('lib/remediation.ts', {});
  const savedReview = createMockReview({ lesson: original, result: latest });
  const learningModule = {
    id: original.moduleId, title: original.title, description: 'Read customer CSV data and compute numeric summaries.',
    prerequisites: [], resources: [], estimatedDuration: 45, status: 'in-progress', topics: ['CSV values', 'Dictionaries', 'Counting customers'],
  };
  const context = {
    ready: true,
    state: {
      version: 1,
      profile: { id: 'quiz-ui-learner', name: 'Jordan', background: 'Customer support', experience: '', skills: ['Spreadsheets'], goals: 'Analyze customer data', availableStudyTime: 5, track: 'data-science' },
      plan: { id: 'quiz-ui-plan', profileId: 'quiz-ui-learner', title: 'Customer analysis', summary: 'Practice with customer rows.', track: 'data-science', modules: [learningModule], weeklyStudyHours: 5, generatedAt: '2026-10-31T12:00:00.000Z' },
      planGeneration: 'quiz-ui-generation', lessons: { [original.moduleId]: clone(original) },
      quizResults: { [original.moduleId]: latest }, latestQuizResults: { [original.moduleId]: latest },
      quizHistory: { [original.moduleId]: [earlier, latest] }, remediations: { [original.moduleId]: savedReview },
      lessonModes: { [original.moduleId]: 'claude' },
    },
    saveLesson() { throw new Error('Cached lesson must not be regenerated for a quiz refresh'); },
    startModule() {}, recordQuizResult() {}, saveRemediation() {},
    replaceQuiz(...args) {
      replacements.push(args);
      const [lessonId, moduleId, questions] = args;
      if (context.state.lessons[moduleId]?.id === lessonId) {
        context.state = { ...context.state, lessons: { ...context.state.lessons, [moduleId]: { ...context.state.lessons[moduleId], quiz: clone(questions) } } };
      }
    },
    markRemediationReviewed(...args) {
      reviewed.push(args);
      const [moduleId, completedAt] = args;
      const review = context.state.remediations[moduleId];
      if (review?.review.attemptedAt === completedAt) {
        context.state = { ...context.state, remediations: { ...context.state.remediations, [moduleId]: { ...review, reviewedAt: '2026-10-31T12:01:00.000Z' } } };
      }
    },
  };
  const { LessonExperience } = load('components/lesson-experience.tsx', {
    react: state.react, 'react/jsx-runtime': jsx, 'next/link': 'a',
    '@/app/learn/lesson.css': {}, '@/components/app-shell': { AppShell: 'AppShell' },
    '@/components/icon': { Icon: () => null }, '@/components/lecture-chat': { LectureChat: 'LectureChat' },
    '@/components/lecture-player': { LecturePlayer: 'LecturePlayer' }, '@/components/quiz': { Quiz: 'Quiz' },
    '@/lib/learning-context': { useLearning: () => context },
    '@/lib/api-client': {
      requestLessonResponse: async () => { throw new Error('Unexpected lesson generation'); },
      requestQuizRefreshResponse(lesson, previousQuestions, questionCount, signal) {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        requests.push({ lesson, previousQuestions, questionCount, signal, resolve, reject });
        return promise;
      },
    },
  });
  let tree, pauses = 0;
  const render = () => {
    tree = state.render(() => LessonExperience({ moduleId: original.moduleId }));
    const player = find(tree, node => node.type === 'LecturePlayer');
    if (player) player.props.pauseNarrationRef.current = () => { pauses++; };
    return tree;
  };
  const quiz = () => find(tree, node => node.type === 'Quiz');
  render();
  return {
    context, render, quiz, requests, replacements, reviewed, scrolls, earlier, latest,
    unmount: () => state.unmount(),
    get tree() { return tree; }, get pauses() { return pauses; },
  };
}

async function parentChecks() {
  const before = assertions;
  const originalDocument = global.document, originalAnimationFrame = global.requestAnimationFrame, originalFetch = global.fetch;
  let scrollCount = 0, unexpectedRequests = 0;
  global.document = { getElementById: () => ({ scrollIntoView: () => { scrollCount++; }, focus() {} }) };
  global.requestAnimationFrame = callback => { callback(); return 0; };
  global.fetch = async () => { unexpectedRequests++; throw new Error('Unexpected network request in parent UI checks'); };
  const settle = () => new Promise(setImmediate);
  const response = (lesson = original, quiz = refreshed.quiz) => ({ lessonId: lesson.id, moduleId: lesson.moduleId, quiz: clone(quiz), mode: 'claude' });
  try {
    const success = parentHarness();
    const initialQuiz = success.quiz(), initialKey = initialQuiz.key;
    initialQuiz.props.onRetry(); initialQuiz.props.onRetry(); success.render();
    equal(success.requests.length, 1, 'Double retry clicks create one parent generation request');
    equal(success.requests[0].questionCount, 5, 'The parent defaults an active five-question quiz to five questions');
    check(success.quiz().props.retryBusy, 'The parent exposes its pending refresh to the quiz');
    equal(success.quiz().key, initialKey, 'The parent keeps the scored quiz mounted while replacement questions load');
    equal(success.requests[0].lesson, original, 'Quiz generation receives the cached lesson with unchanged teaching content');
    const supplied = success.requests[0].previousQuestions;
    check(original.quiz.every(question => supplied.includes(question.question)), 'The exclusion list includes every current question');
    check(success.earlier.questions.every(question => supplied.includes(question.question)), 'The exclusion list also includes historical question stems');
    check(success.pauses === 1, 'Beginning a quiz refresh pauses lesson narration once');
    success.requests[0].resolve(response()); await settle(); success.render();
    equal(success.replacements[0], [original.id, original.moduleId, refreshed.quiz, 'quiz-ui-plan', 'quiz-ui-generation'], 'Successful generation is saved against the expected lesson, plan, and generation');
    check(success.quiz().key !== initialKey, 'The parent remounts the quiz only after new questions are saved');
    equal(success.quiz().props.lesson.quiz, refreshed.quiz, 'The remounted quiz receives the replacement questions');
    equal(success.quiz().props.lesson.slides, original.slides, 'Refreshing a quiz preserves the lesson slides');
    equal(success.context.state.quizResults[original.moduleId], success.latest, 'Refreshing questions leaves the prior score intact');
    check(!success.quiz().props.retryBusy && !success.quiz().props.retryError, 'The parent clears refresh status after success');
    check(scrollCount > 0, 'Successful refresh returns the learner to the knowledge check');
    success.unmount();

    for (const count of [7, 10]) {
      const selected = parentHarness(), selectedKey = selected.quiz().key;
      selected.quiz().props.onQuestionCountChange(count); selected.render();
      equal(selected.quiz().props.questionCount, count, `The parent retains the selected count of ${count}`);
      equal(selected.requests.length, 0, 'Choosing a count does not send a generation request');
      equal(selected.quiz().key, selectedKey, 'Changing a count keeps the current answer state mounted');
      selected.quiz().props.onRetry(); selected.render();
      equal(selected.requests[0].questionCount, count, `The parent requests exactly ${count} fresh questions`);
      check(selected.requests[0].signal instanceof AbortSignal, 'Cancellation is still passed after the new count argument');
      const nextQuiz = sizedLesson(count, `parent-count-${count}`).quiz;
      selected.requests[0].resolve(response(original, nextQuiz)); await settle(); selected.render();
      equal(selected.quiz().props.lesson.quiz.length, count, `The replacement quiz renders all ${count} generated questions`);
      equal(selected.context.state.quizResults[original.moduleId], selected.latest, 'Changing assessment length preserves previous results');
      selected.unmount();
    }

    const legacySetup = parentHarness();
    legacySetup.context.state = { ...legacySetup.context.state, lessons: { [original.moduleId]: { ...clone(original), quiz: clone(original.quiz.slice(0, 3)) } } };
    legacySetup.render();
    equal(legacySetup.quiz().props.questionCount, 5, 'A legacy three-question lesson defaults the parent to five');
    legacySetup.quiz().props.onRetry();
    equal(legacySetup.requests[0].questionCount, 5, 'Legacy setup generates the minimum five questions');
    legacySetup.unmount();

    const tenReady = parentHarness();
    tenReady.context.state = { ...tenReady.context.state, lessons: { [original.moduleId]: sizedLesson(10, 'restored-ten') } };
    tenReady.render();
    equal(tenReady.quiz().props.questionCount, 10, 'An active restored ten-question quiz selects ten without generating again');
    tenReady.unmount();

    const failed = parentHarness(), failedKey = failed.quiz().key;
    failed.quiz().props.onRetry(); failed.render();
    failed.requests[0].reject(new Error('New questions are temporarily unavailable.')); await settle(); failed.render();
    equal(failed.replacements.length, 0, 'Failed generation never replaces the cached quiz');
    equal(failed.quiz().key, failedKey, 'A refresh error preserves the current quiz component state');
    equal(failed.quiz().props.lesson.quiz, original.quiz, 'A refresh error preserves the existing question set');
    equal(failed.context.state.quizResults[original.moduleId], failed.latest, 'A refresh error preserves earlier results');
    check(!failed.quiz().props.retryBusy && failed.quiz().props.retryError.includes('temporarily unavailable'), 'A parent failure clears loading and supplies a retryable error');
    failed.quiz().props.onRetry();
    equal(failed.requests.length, 2, 'A failed parent request releases the retry guard');
    failed.unmount();
    check(failed.requests[1].signal.aborted, 'Unmounting aborts a pending quiz refresh');
    failed.requests[1].resolve(response()); await settle();
    equal(failed.replacements.length, 0, 'A response arriving after unmount cannot replace a quiz');

    const navigation = parentHarness();
    navigation.quiz().props.onQuestionCountChange(10); navigation.render();
    navigation.quiz().props.onRetry();
    const stale = navigation.requests[0];
    const replacementLesson = { ...clone(original), id: 'replacement-lesson' };
    navigation.context.state = {
      ...navigation.context.state, planGeneration: 'replacement-generation',
      plan: { ...navigation.context.state.plan, id: 'replacement-plan' },
      lessons: { [original.moduleId]: replacementLesson }, latestQuizResults: {}, remediations: {},
    };
    navigation.render();
    check(stale.signal.aborted, 'Changing lesson identity aborts the previous quiz request');
    equal(navigation.quiz().props.questionCount, 5, 'A different lesson resets draft count to its own active quiz length');
    navigation.quiz().props.onRetry(); navigation.render();
    equal(navigation.requests.length, 2, 'The replacement lesson can begin its own refresh');
    stale.resolve(response()); await settle(); navigation.render();
    equal(navigation.replacements.length, 0, 'A stale response cannot overwrite a different lesson');
    check(navigation.quiz().props.retryBusy, 'A stale request completion cannot clear a newer pending request');
    navigation.quiz().props.onRetry();
    equal(navigation.requests.length, 2, 'The new request remains protected against duplicate clicks');
    navigation.requests[1].resolve(response(replacementLesson)); await settle(); navigation.render();
    equal(navigation.replacements[0].slice(3), ['replacement-plan', 'replacement-generation'], 'The replacement request saves only against its own plan identity');
    navigation.unmount();

    const review = parentHarness();
    button(review.tree, 'I’ve reviewed — try new questions').props.onClick(); review.render();
    equal(review.requests.length, 1, 'The targeted-review retry action also requests a new quiz');
    equal(review.reviewed.length, 0, 'Review completion is not marked while question generation is pending');
    review.requests[0].resolve(response()); await settle(); review.render();
    equal(review.reviewed, [[original.moduleId, review.latest.completedAt]], 'Successful review retry marks only the reviewed attempt');
    const returnButton = button(review.tree, 'Return to the knowledge check');
    check(returnButton, 'The reviewed attempt offers navigation once fresh questions are already present');
    returnButton.props.onClick();
    equal(review.requests.length, 1, 'Returning to an already fresh quiz does not discard it or generate another set');
    review.unmount();
    await settle();
    equal(unexpectedRequests, 0, 'Parent refresh checks perform no live requests or unsolicited review generation');
    console.log(`PASS ${assertions - before} lesson-parent assertions: refresh deduplication, history exclusions, successful replacement, error preservation, targeted review, and stale-request cancellation.`);
  } finally {
    if (originalDocument === undefined) delete global.document; else global.document = originalDocument;
    if (originalAnimationFrame === undefined) delete global.requestAnimationFrame; else global.requestAnimationFrame = originalAnimationFrame;
    global.fetch = originalFetch;
  }
}

(async () => { run(); await parentChecks(); })().catch(error => { console.error(error); process.exitCode = 1; });
