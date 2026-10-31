/* eslint-disable @typescript-eslint/no-require-imports */
/** Detailed teaching contracts with actual validation and a stubbed provider. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), modules = new Map();
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const clone = value => JSON.parse(JSON.stringify(value));
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const item = { exports: {} }; modules.set(filename, item);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const nativeRequire = NativeModule.createRequire(filename);
  const requireLocal = name => name === 'server-only' ? {} : name.startsWith('@/') ? load(name.slice(2) + '.ts') : nativeRequire(name);
  new Function('require', 'module', 'exports', output)(requireLocal, item, item.exports);
  return item.exports;
}
const route = load('app/api/lesson/detail/route.ts');
const { assertLesson } = load('lib/validators.ts');
const { getTeachingScenes, createTeachingFrames, narrationBeats } = load('lib/teaching-scenes.ts');
const learningModule = { id: 'detail-module', title: 'Customer SQL summaries', description: 'Learn SQL queries, grouping, and order counts for customer analysis.', prerequisites: [], resources: [], estimatedDuration: 60, status: 'not-started', topics: ['SQL queries', 'GROUP BY', 'Counting orders'] };
const lesson = {
  id: 'detail-lesson', moduleId: learningModule.id, title: learningModule.title,
  slides: [
    { id: 'detail-slide-1', title: 'Customer order groups', bullets: ['GROUP BY makes one group per customer.', 'COUNT(*) counts rows inside each group.'], narration: 'GROUP BY makes one group per customer. COUNT(*) counts rows inside each group. A customer with three orders has a count of three.' },
    { id: 'detail-slide-2', title: 'Filtering grouped results', bullets: ['WHERE filters orders before grouping.', 'HAVING filters customer groups after aggregation.'], narration: 'WHERE filters orders before grouping. HAVING filters customer groups after aggregation. Use WHERE on order status and HAVING on the grouped count.' },
  ],
  quiz: [{ id: 'saved-quiz', question: 'Which SQL clause groups customer rows?', options: ['GROUP BY', 'LIMIT', 'ORDER BY', 'WHERE'], correctAnswer: 0, explanation: 'GROUP BY collects rows into customer groups.' }],
};
function teachingDraft() {
  return { slides: lesson.slides.map((slide, index) => ({ id: slide.id, scenes: [
    { title: `Understand customer groups ${index}`, narration: 'A SQL customer group collects orders that share the same customer identifier. Think of placing each order into a labeled customer basket before counting. This separates the question of which rows belong together from the calculation performed on each group.', visual: { kind: 'concept', lines: ['Orders: A, A, B', 'Customer groups: A → 2 orders; B → 1 order'] } },
    { title: `Trace the SQL result ${index}`, narration: 'Start with three orders: two belong to customer A and one belongs to customer B. Group by the customer identifier, then count the rows in each group. The result has two rows, showing A with two orders and B with one order; it does not return three individual orders.', visual: { kind: 'code', lines: ['SELECT customer_id, COUNT(*) AS n', 'FROM orders GROUP BY customer_id;', 'Result: A | 2; B | 1'] } },
    { title: `Check the grouping decision ${index}`, narration: 'Check that the grouped order counts add back to the original number of input rows. Two plus one equals three, so this example accounts for every order once. A common mistake is to count the two result groups as if they were two orders; groups and input rows answer different questions.', visual: { kind: 'calculation', lines: ['Input rows = 3; output customer groups = 2', 'Check: 2 + 1 = 3 orders'] } },
  ] })) };
}
const input = (changes = {}) => ({ lesson, module: learningModule, ...changes });
const request = (body, options = {}) => new Request('http://localhost/api/lesson/detail', {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...options.headers },
  body: typeof body === 'string' ? body : JSON.stringify(body), signal: options.signal,
});
const post = (body = input(), options) => route.POST(request(body, options));
let calls = [];
function provider(draft = teachingDraft(), options = {}) {
  calls = [];
  global.fetch = async (url, init) => {
    equal(url, 'https://api.anthropic.com/v1/messages', 'Details use the existing provider boundary');
    const body = JSON.parse(init.body); calls.push({ body, payload: JSON.parse(body.messages[0].content) });
    if (options.network) throw new Error('PRIVATE_DETAIL_ERROR');
    return new Response(options.status ? 'PRIVATE_DETAIL_ERROR' : JSON.stringify({ stop_reason: options.stopReason ?? 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }] }), { status: options.status ?? 200 });
  };
}
async function failure(response, status, label) {
  equal(response.status, status, `${label}: status`);
  equal(response.headers.get('cache-control'), 'no-store', `${label}: not cached`);
  const value = await response.json();
  check(typeof value.error?.message === 'string' && value.error.message.length > 0, `${label}: readable error`);
  check(!JSON.stringify(value).includes('PRIVATE_DETAIL_ERROR') && !JSON.stringify(value).includes('test-detail-key'), `${label}: provider details remain private`);
}
const originalFetch = global.fetch, originalKey = process.env.ANTHROPIC_API_KEY;
(async () => {
  try {
    const decimal = 'Compute AVG(CASE WHEN n >= 2 THEN 1.0 ELSE 0 END). Then divide 40 by 100 to get 0.40. Read customer.id as one field.';
    const decimalBeats = narrationBeats(decimal);
    equal(decimalBeats.join(' '), decimal, 'Sentence beats retain every word, decimal, SQL expression, and identifier');
    check(decimalBeats.every(beat => beat.length <= 280), 'Typical playback beats fit the caption budget');
    const longer = 'A customer order belongs to one group. '.repeat(25).trim();
    equal(narrationBeats(longer).join(' '), longer, 'Long narration is neither dropped nor duplicated across beats');
    check(narrationBeats(longer).length > 3, 'Long narration receives several visible teaching beats');
    const legacyScenes = getTeachingScenes(lesson.slides[0]);
    equal(legacyScenes.map(scene => scene.narration).join(' '), lesson.slides[0].narration, 'Legacy scenes use only original teaching text');
    const legacyFrames = createTeachingFrames(lesson.slides);
    equal(legacyFrames.map(frame => frame.narration).join(' '), lesson.slides.map(slide => slide.narration).join(' '), 'Legacy playback covers the full lecture in order');
    equal([...new Set(legacyFrames.map(frame => frame.slideIndex))], [0, 1], 'Frames retain parent slide mapping');

    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = async () => { throw new Error('Mock expansion must not call the provider'); };
    const fallbackResponse = await post();
    equal(fallbackResponse.status, 200, 'Unconfigured narration receives a faithful scene sequence');
    const fallback = await fallbackResponse.json();
    equal(fallback.mode, 'mock', 'A local scene sequence is honestly labeled mock');
    equal(fallback.lesson.quiz, lesson.quiz, 'Local scene preparation preserves the saved assessment');
    equal(fallback.lesson.slides.map(slide => slide.narration), lesson.slides.map(slide => slide.narration), 'Local preparation does not fabricate a longer explanation');
    assertLesson(fallback.lesson); assertions++;

    for (const body of [null, [], {}, input({ lesson: {} }), input({ module: { ...learningModule, id: 'wrong-module' } }), input({ module: { ...learningModule, title: 'Different lesson' } }), input({ extra: true }), input({ lesson: { ...lesson, slides: new Array(9).fill(null).map((_, i) => ({ ...lesson.slides[0], id: `too-many-${i}` })) } })])
      await failure(await post(body), 400, 'Invalid detail input');
    await failure(await post('{broken'), 400, 'Malformed JSON');
    await failure(await post(input(), { headers: { Origin: 'https://elsewhere.example' } }), 403, 'Cross-origin request');
    await failure(await post(input(), { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'Cross-site request');
    await failure(await post(input(), { headers: { 'Content-Type': 'text/plain' } }), 415, 'Non-JSON request');
    await failure(await post(input(), { headers: { 'Content-Length': '65537' } }), 413, 'Oversized input');

    process.env.ANTHROPIC_API_KEY = 'test-detail-key';
    provider();
    const response = await post(input(), { headers: { Host: '127.0.0.1:3002', Origin: 'http://127.0.0.1:3002' } });
    equal(response.status, 200, 'Detailed generation accepts the actual loopback Host');
    equal(response.headers.get('cache-control'), 'no-store', 'Expanded lessons are not cached by HTTP');
    const result = await response.json();
    equal(result.mode, 'claude', 'Successful details expose their actual source');
    equal(result.lesson.id, lesson.id, 'The lesson identity is preserved');
    equal(result.lesson.moduleId, lesson.moduleId, 'The parent module is preserved');
    equal(result.lesson.title, lesson.title, 'The lesson title is preserved');
    equal(result.lesson.quiz, lesson.quiz, 'The entire current assessment is preserved');
    equal(result.lesson.slides.map(({ id, title, bullets }) => ({ id, title, bullets })), lesson.slides.map(({ id, title, bullets }) => ({ id, title, bullets })), 'Slide IDs, titles, bullets, and order remain stable for historical reviews');
    check(result.lesson.slides.every(slide => slide.scenes.length === 3 && slide.narration.length > lesson.slides[0].narration.length), 'Each slide receives a more detailed sequence of explanations');
    check(result.lesson.slides.every(slide => slide.narration === slide.scenes.map(scene => scene.narration).join(' ')), 'The transcript exactly matches scene narration');
    check(calls[0].body.system.includes('intermediate values') && calls[0].body.system.includes('plausible mistake'), 'The author is asked to teach worked reasoning and counterexamples');
    equal(calls[0].payload.slides.map(slide => slide.id), lesson.slides.map(slide => slide.id), 'The author receives source slides and identities');
    assertLesson(result.lesson); assertions++;
    const frames = createTeachingFrames(result.lesson.slides);
    equal(frames.map(frame => frame.narration).join(' '), result.lesson.slides.map(slide => slide.narration).join(' '), 'Detailed playback speaks all generated narration once in order');
    equal(frames[0].scene, result.lesson.slides[0].scenes[0], 'Each frame carries the matching authored visual');
    check(frames.length > result.lesson.slides.length * 3, 'Each scene has short evolving caption beats rather than one static screen per slide');

    const mutations = [
      draft => { draft.slides.reverse(); },
      draft => { draft.slides[0].id = 'invented-slide'; },
      draft => { draft.slides[0].scenes = draft.slides[0].scenes.slice(0, 2); },
      draft => { draft.slides[0].scenes[0].visual.kind = 'html'; },
      draft => { draft.slides[0].scenes[0].visual.lines = ['Only one line']; },
      draft => { draft.slides[0].scenes[0].narration = 'x'.repeat(701); },
      draft => { draft.slides[0].scenes.forEach(scene => { scene.narration = 'Too short.'; }); },
      draft => { draft.slides[0].scenes[1].title = draft.slides[0].scenes[0].title; },
      draft => { draft.slides[0].scenes[0].unsafe = true; },
      draft => { draft.quiz = []; },
      draft => { draft.slides[0].scenes.forEach(scene => { scene.narration = ('Volcanic minerals cover distant planets. Crystals cool beneath oceanic volcanoes. ').repeat(4); scene.visual.lines = ['Basalt', 'Granite']; }); },
    ];
    for (const mutate of mutations) {
      const draft = teachingDraft(); mutate(draft); provider(draft);
      await failure(await post(), 500, 'Invalid provider teaching draft');
    }
    const mismatchedTranscript = clone(result.lesson);
    mismatchedTranscript.slides[0].narration += ' Unspoken sentence.';
    assert.throws(() => assertLesson(mismatchedTranscript)); assertions++;
    const oversizedAssessment = clone(lesson);
    oversizedAssessment.quiz = Array.from({ length: 4 }, (_, index) => ({
      ...lesson.quiz[0], id: `large-question-${index}`, question: 'Q'.repeat(2000),
      options: ['A', 'B', 'C', 'D'].map(letter => letter.repeat(2000)), explanation: 'E'.repeat(2000),
    }));
    provider();
    await failure(await post(input({ lesson: oversizedAssessment })), 500, 'Expanded lesson reserves room for downstream quiz snapshots');
    provider(undefined, { network: true }); await failure(await post(), 500, 'Provider connection failure');
    provider(undefined, { status: 401 }); await failure(await post(), 500, 'Provider authorization failure');
    provider(undefined, { stopReason: 'max_tokens' }); await failure(await post(), 500, 'Truncated generated teaching');
    const controller = new AbortController(); controller.abort(); provider();
    await failure(await post(input(), { signal: controller.signal }), 499, 'Canceled detail request');
    equal(calls.length, 0, 'Already canceled expansion never invokes the provider');
    console.log(`PASS ${assertions} detailed lesson assertions: faithful beats, exact narration, grounded expansion, stable identities, progress-safe contracts, and failures.`);
    console.log('Provider transport was stubbed; no credentials or live API calls were used.');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
