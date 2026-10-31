/* eslint-disable @typescript-eslint/no-require-imports */
/** Retake generation regressions with real validators and stubbed provider transport. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const clone = value => JSON.parse(JSON.stringify(value));
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const item = { exports: {} }; modules.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const nativeRequire = NativeModule.createRequire(filename);
  const requireLocal = name => {
    if (name === 'server-only') return {};
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    return nativeRequire(name);
  };
  new Function('exports', 'require', 'module', code)(item.exports, requireLocal, item);
  return item.exports;
}
const route = load('app/api/quiz/route.ts');
const { assertQuizRefreshResponse, normalizeQuizQuestion, isQuizQuestionCount, QUIZ_QUESTION_COUNTS } = load('lib/quiz-refresh.ts');
const { requestQuizRefreshResponse } = load('lib/api-client.ts');
const { answerQuestion } = load('lib/ai.ts');
const lesson = {
  id: 'quiz-refresh-lesson', moduleId: 'quiz-refresh-module', title: 'Python customer reports',
  slides: [
    { id: 'variables', title: 'Named variables', bullets: ['A variable stores a value under a name.', 'Assign a spend value before using it in a total.'], narration: 'Python variables let an analyst refer to a named value while building a customer report.' },
    { id: 'csv', title: 'CSV data conversion', bullets: ['CSV rows store spend as text.', 'Convert spend text with float before summing amounts.'], narration: 'Convert a text value into a number before adding customer spend to a numeric total.' },
    { id: 'loops', title: 'Loops over customer rows', bullets: ['A loop repeats its body for every customer row.', 'Start the running total at zero before the loop.'], narration: 'A Python loop processes one row at a time, repeating the body for each customer row.' },
  ],
  quiz: [0, 1, 2].map(index => ({ id: `original-${index}`, question: `Original Python question ${index}?`, options: ['Named value', 'Unknown guess', 'Ignore the row', 'Skip the task'], correctAnswer: 0, explanation: 'Use the named Python value from the lesson.' })),
};
const draft = {
  quiz: [
    { question: 'Which Python value should an analyst store before calculating a total?', options: ['Store the spend in a named variable.', 'Ignore all spend values.', 'Replace the total with a random guess.', 'Avoid assigning any named values.'], correctAnswer: 0, explanation: 'A Python variable stores a named value, so assign spend before using it in the total.' },
    { question: 'A CSV row stores spend as text. What should happen before adding it to a numeric total?', options: ['Keep the spend as text.', 'Convert the spend with float.', 'Delete the customer row.', 'Reset the total after every row.'], correctAnswer: 1, explanation: 'CSV spend starts as text. Convert it with float before adding it to the numeric total.' },
    { question: 'A loop processes four customer rows once each. How often does its repeated body run?', options: ['Zero times', 'One time', 'Four times', 'Eight times'], correctAnswer: 2, explanation: 'The loop repeats its body for every customer row, so four rows require four repetitions.' },
    { question: 'A running total begins at 10 before adding customer spend. Which change follows the lesson?', options: ['Add a random number.', 'Keep the starting 10.', 'Skip the first customer.', 'Start the running total at zero.'], correctAnswer: 3, explanation: 'The lesson starts the total at zero so only actual customer spend is counted.' },
    { question: 'Which Python line names a value before it is used in a customer report?', options: ['spend = 25', 'Ignore the spend column', 'Delete every row', 'Skip the total'], correctAnswer: 0, explanation: 'Assigning spend = 25 stores a value under the variable name spend.' },
  ],
};
function draftFor(count) {
  const result = clone(draft);
  while (result.quiz.length < count) {
    const index = result.quiz.length;
    result.quiz.push({ question: `For customer report example ${index}, which Python loop principle should guide the total?`, options: ['Repeat the body for each customer row.', 'Skip every row.', 'Ignore the spend value.', 'Choose a random result.'], correctAnswer: 0, explanation: 'A loop repeats the body once for each customer row.' });
  }
  return { quiz: result.quiz.slice(0, count) };
}
const input = (extra = {}) => ({ lesson, previousQuestions: [], ...extra });
const request = (body, options = {}) => new Request('http://localhost/api/quiz', {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...options.headers },
  body: typeof body === 'string' ? body : JSON.stringify(body), signal: options.signal,
});
const post = (body = input(), options) => route.POST(request(body, options));
async function failure(response, status, label) {
  equal(response.status, status, `${label}: correct status`);
  equal(response.headers.get('cache-control'), 'no-store', `${label}: not cached`);
  const body = await response.json();
  check(typeof body.error?.message === 'string' && body.error.message.length > 0, `${label}: user-readable message`);
  check(!JSON.stringify(body).includes('PRIVATE_QUIZ_PROVIDER_DETAIL') && !JSON.stringify(body).includes('fake-retake-provider-key'), `${label}: no secrets or upstream details`);
}
let calls = [];
function provider(value = draft, options = {}) {
  calls = [];
  global.fetch = async (url, init) => {
    equal(url, 'https://api.anthropic.com/v1/messages', 'Only the existing Claude boundary is contacted');
    const body = JSON.parse(init.body);
    calls.push({ body, payload: JSON.parse(body.messages[0].content) });
    if (options.network) throw new Error('PRIVATE_QUIZ_PROVIDER_DETAIL');
    return new Response(options.status ? 'PRIVATE_QUIZ_PROVIDER_DETAIL' : JSON.stringify({
      stop_reason: options.stopReason ?? 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }],
    }), { status: options.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
}
const originalFetch = global.fetch;
const oldKey = process.env.ANTHROPIC_API_KEY;
(async () => {
  try {
    for (const [count, requiredCorrect] of [[5, 4], [7, 5], [10, 7]]) {
      const sizedLesson = { ...lesson, quiz: Array.from({ length: count }, (_, index) => ({
        ...lesson.quiz[index % lesson.quiz.length], id: `mock-tutor-question-${index}`,
      })) };
      const response = await answerQuestion({ lesson: sizedLesson, question: 'What score do I need to pass the quiz?', messages: [] });
      check(response.message.content.includes(`you need at least ${requiredCorrect} of ${count} correct`), `Mock tutor explains the passing count for ${count} questions`);
      check(!response.message.content.includes('with three questions'), 'Mock tutor does not give obsolete three-question guidance');
    }
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = async () => { throw new Error('Mock mode must not call a provider'); };
    const largestMockResponse = await post(input({ questionCount: 10 }));
    equal(largestMockResponse.status, 200, 'Mock mode supports the maximum selected count');
    equal((await largestMockResponse.json()).quiz.length, 10, 'Mock mode returns ten questions when selected');
    let currentLesson = clone(lesson), history = [], generated = 0, exhausted = false;
    for (let index = 0; index < 12; index++) {
      const response = await post({ lesson: currentLesson, previousQuestions: history });
      if (response.status === 503) { exhausted = true; break; }
      equal(response.status, 200, 'A mock retake can generate unused lesson-based questions');
      const result = await response.json();
      assertQuizRefreshResponse(result, currentLesson, history); assertions++;
      equal(result.mode, 'mock', 'Unconfigured generation is labeled mock');
      const sourceFacts = new Set(lesson.slides.flatMap(slide => slide.bullets));
      check(result.quiz.every(question => sourceFacts.has(question.options[question.correctAnswer])), 'Mock correct answers are actual lesson facts');
      check(result.quiz.every(question => !history.map(normalizeQuizQuestion).includes(normalizeQuizQuestion(question.question))), 'Successive mock retakes do not repeat earlier stems');
      history.push(...result.quiz.map(question => question.question));
      currentLesson = { ...currentLesson, quiz: result.quiz };
      generated += 5;
    }
    check(generated >= 10 && exhausted, 'The finite mock bank supports multiple retakes and fails explicitly instead of recycling questions');

    for (const body of [null, [], {}, input({ lesson: {} }), input({ previousQuestions: new Array(61).fill('Earlier question') }), input({ previousQuestions: [4] }), input({ previousQuestions: [' '] }), input({ previousQuestions: ['x'.repeat(2001)] }), input({ unrelated: true }), ...[null, '5', 4, 11, 5.5, true].map(questionCount => input({ questionCount }))]) {
      await failure(await post(body), 400, 'Invalid quiz request');
    }
    await failure(await post('{invalid'), 400, 'Malformed JSON');
    await failure(await post(input(), { headers: { Origin: 'https://another.example' } }), 403, 'Cross-origin request');
    await failure(await post(input(), { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'Cross-site request');
    await failure(await post(input(), { headers: { Host: 'localhost', Origin: 'https://another.example', 'X-Forwarded-Host': 'another.example' } }), 403, 'Forwarded host cannot grant access');
    await failure(await post(input(), { headers: { 'Content-Type': 'text/plain' } }), 415, 'Wrong content type');
    await failure(await post(input(), { headers: { 'Content-Length': '65537' } }), 413, 'Oversized declared request');

    process.env.ANTHROPIC_API_KEY = 'fake-retake-provider-key';
    provider();
    let response = await post(input({ previousQuestions: ['What did the earlier CSV question ask?'] }), { headers: { Host: '127.0.0.1:3002', Origin: 'http://127.0.0.1:3002' } });
    equal(response.status, 200, 'Configured Claude generation succeeds for the actual loopback Host');
    equal(response.headers.get('cache-control'), 'no-store', 'New quizzes are not cached');
    const result = await response.json();
    assertQuizRefreshResponse(result, lesson, []); assertions++;
    equal(result.mode, 'claude', 'Successful AI questions expose their actual source');
    equal(result.quiz.length, 5, 'Omitted count defaults to five fresh questions');
    equal(QUIZ_QUESTION_COUNTS, [5, 6, 7, 8, 9, 10], 'The dropdown count contract covers every allowed count');
    check(QUIZ_QUESTION_COUNTS.every(isQuizQuestionCount), 'Every offered question count is valid');
    for (const questionCount of QUIZ_QUESTION_COUNTS) {
      provider(draftFor(questionCount));
      const variableResponse = await post(input({ questionCount }));
      equal(variableResponse.status, 200, `Count ${questionCount} succeeds`);
      const variableResult = await variableResponse.json();
      equal(variableResult.quiz.length, questionCount, 'The requested count is returned');
      assertQuizRefreshResponse(variableResult, lesson, [], questionCount); assertions++;
      equal(calls[0].payload.questionCount, questionCount, 'Claude receives the selected count');
      check(calls[0].body.system.includes(`exactly ${questionCount} NEW`), 'The author prompt uses the selected count');
      check(calls[0].body.max_tokens >= questionCount * 650, 'The output token budget scales with count');
    }
    provider(draftFor(9)); await failure(await post(input({ questionCount: 10 })), 500, 'Wrong provider question count');
    provider();
    await post(input({ previousQuestions: ['What did the earlier CSV question ask?'] }));
    check(result.quiz.every(question => question.id.startsWith('quiz-') && !lesson.quiz.some(prior => prior.id === question.id)), 'Fresh question IDs are independent of the original quiz');
    equal(calls[0].payload.lesson.slides, lesson.slides, 'Generation receives the lesson teaching material');
    check(calls[0].payload.excludedQuestions.includes(lesson.quiz[0].question) && calls[0].payload.excludedQuestions.includes('What did the earlier CSV question ask?'), 'Current and earlier question text are both excluded');
    check(calls[0].body.system.includes('merely reorder answer options') && calls[0].body.system.includes('grounded only'), 'The author prompt requests substantive new lesson-grounded questions');
    provider(); const second = await (await post()).json();
    check(second.quiz.every(question => !result.quiz.some(prior => prior.id === question.id)), 'Fresh IDs are created for each generation');

    const repeated = clone(draft); repeated.quiz[0].question = ' ORIGINAL  PYTHON QUESTION 0!!! ';
    provider(repeated); await failure(await post(), 500, 'Repeated provider question');
    provider(draft); await failure(await post(input({ previousQuestions: [draft.quiz[1].question] })), 500, 'Repeated prior-attempt question');
    const duplicated = clone(draft); duplicated.quiz[1].question = duplicated.quiz[0].question;
    provider(duplicated); await failure(await post(), 500, 'Duplicate new question');
    const badOptions = clone(draft); badOptions.quiz[0].options[1] = badOptions.quiz[0].options[0].toUpperCase();
    provider(badOptions); await failure(await post(), 500, 'Ambiguous duplicate choices');
    const badAnswer = clone(draft); badAnswer.quiz[0].correctAnswer = 4;
    provider(badAnswer); await failure(await post(), 500, 'Invalid correct choice');
    const tooLong = clone(draft); tooLong.quiz[0].question = 'x'.repeat(501);
    provider(tooLong); await failure(await post(), 500, 'Overlong provider question');
    const unrelated = { quiz: [0, 1, 2, 3, 4].map(index => ({ question: `Which volcanic mineral appears on Mars ${index}?`, options: ['Granite', 'Basalt', 'Slate', 'Quartz'], correctAnswer: 1, explanation: 'Volcanic magma forms basaltic deposits.' })) };
    provider(unrelated); await failure(await post(), 500, 'Unrelated provider material');
    provider({ quiz: [] }); await failure(await post(), 500, 'Missing provider questions');
    provider(draft, { status: 401 }); await failure(await post(), 500, 'Configured authorization failure never substitutes a mock quiz');
    provider(draft, { network: true }); await failure(await post(), 500, 'Configured network failure never substitutes a mock quiz');
    provider(draft, { stopReason: 'max_tokens' }); await failure(await post(), 500, 'Truncated output is rejected');

    const canceled = new AbortController(); canceled.abort();
    provider(); await failure(await post(input(), { signal: canceled.signal }), 499, 'Canceled request');
    equal(calls.length, 0, 'Already canceled requests do not invoke Claude');
    let postedQuizBody;
    const clientResult = { lessonId: lesson.id, moduleId: lesson.moduleId, quiz: draftFor(10).quiz.map((q, index) => ({ ...q, id: `client-${index}` })), mode: 'claude' };
    global.fetch = async (url, init) => { equal(url, '/api/quiz', 'The quiz client calls the local endpoint'); postedQuizBody = JSON.parse(init.body); return Response.json(clientResult); };
    const longHistory = Array.from({ length: 60 }, (_, index) => `${index} ${'old question '.repeat(150)}`);
    const clientResponse = await requestQuizRefreshResponse(lesson, longHistory, 10);
    equal(clientResponse.quiz.length, 10, 'The client validates the selected count');
    equal(postedQuizBody.questionCount, 10, 'The client transmits the selected count');
    check(new TextEncoder().encode(JSON.stringify(postedQuizBody)).byteLength <= 60 * 1024, 'Old exclusions are bounded below the server body cap');
    equal(postedQuizBody.lesson.quiz, lesson.quiz, 'Payload bounding never removes current quiz stems');
    await assert.rejects(() => requestQuizRefreshResponse(lesson, [], 4), /between 5 and 10/); assertions++;
    global.fetch = async () => Response.json(clientResult);
    await assert.rejects(() => requestQuizRefreshResponse(lesson, [], 5), /did not match this lesson/); assertions++;
    const preserved = clone(lesson);
    assert.throws(() => assertQuizRefreshResponse({ ...result, lessonId: 'different' }, lesson, []), /did not match this lesson/); assertions++;
    equal(lesson, preserved, 'Draft validation never mutates the learner’s current lesson');
    console.log(`PASS ${assertions} quiz refresh assertions: new questions, lesson grounding, request validation, mock exhaustion, safe provider failures, and cancellation.`);
    console.log('Claude transport was stubbed; no credentials or live API calls were used.');
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
