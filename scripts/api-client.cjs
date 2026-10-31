/* eslint-disable @typescript-eslint/no-require-imports */
/** Browser request deadlines, cancellation, and first-request regressions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.startsWith('@/')
    ? load(name.slice(2) + '.ts') : require(name), item, item.exports);
  return item.exports;
}
const client = load('lib/api-client.ts');
const { AI_CLIENT_TIMEOUT_MS, AI_DETAIL_CLIENT_TIMEOUT_MS } = load('lib/ai-budget.ts');
const original = { fetch: global.fetch, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const lesson = {
  id: 'client-lesson', moduleId: 'client-module', title: 'Client requests',
  slides: [{ id: 'slide', title: 'Requests', bullets: ['Keep one request pending.'], narration: 'Keep one request pending until it completes.' }],
  quiz: [{ id: 'question', question: 'How many requests?', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 0, explanation: 'One request is enough.' }],
};
const moduleInput = { id: lesson.moduleId, title: lesson.title };
const answer = { message: { id: 'answer', role: 'assistant', content: 'Keep the first request pending.' }, mode: 'claude' };
const timers = new Map(); let nextTimer = 0, now = 0;
global.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; };
global.clearTimeout = id => timers.delete(id);
function advance(ms) {
  now += ms;
  for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
}
(async () => {
  try {
    let calls = 0;
    global.fetch = async (_url, init) => {
      calls++;
      return new Promise((resolve, reject) => {
        setTimeout(() => resolve(Response.json(answer)), 32_000);
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    };
    const cold = client.requestTutorResponse(lesson, 'Explain?', []);
    advance(32_000);
    equal(await cold, answer);
    equal(calls, 1);
    equal(timers.size, 0);
    equal(AI_CLIENT_TIMEOUT_MS > 60_000, true);

    // A timeout after headers must be identified as a timeout, including reads.
    global.fetch = async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }) });
    const stalled = client.requestTutorResponse(lesson, 'Explain?', []);
    await Promise.resolve();
    advance(AI_CLIENT_TIMEOUT_MS);
    await assert.rejects(stalled, /took too long/); assertions++;
    equal(timers.size, 0);

    const controller = new AbortController();
    const canceled = client.requestLessonDetailResponse(lesson, moduleInput, controller.signal);
    await Promise.resolve();
    const reason = new DOMException('Quiz takes priority', 'AbortError');
    controller.abort(reason);
    await assert.rejects(canceled, error => error === reason); assertions++;
    equal(timers.size, 0);
    equal(AI_DETAIL_CLIENT_TIMEOUT_MS > 75_000, true);

    // Authentication failures and network errors never replay a paid request.
    calls = 0;
    global.fetch = async () => { calls++; return Response.json({ error: { message: 'Check the server API key.' } }, { status: 401 }); };
    await assert.rejects(client.requestTutorResponse(lesson, 'Explain?', []), /Check the server API key/); assertions++;
    equal(calls, 1);
    equal(timers.size, 0);
    global.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(client.requestTutorResponse(lesson, 'Explain?', []), /Could not reach OwnPath/); assertions++;
    equal(timers.size, 0);
    console.log(`PASS ${assertions} API client assertions: cold first request, body-read timeout, background cancellation, no replay, and timer cleanup.`);
  } finally {
    Object.assign(global, original);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
