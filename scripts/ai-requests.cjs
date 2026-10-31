/* eslint-disable @typescript-eslint/no-require-imports */
/** Request lifecycle regressions with a virtual clock and stubbed provider. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), modules = new Map();
let assertions = 0;
function check(value, label) { assert.ok(value, label); assertions++; }
function equal(value, expected, label) { assert.deepEqual(value, expected, label); assertions++; }
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const item = { exports: {} }; modules.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const nativeRequire = NativeModule.createRequire(filename);
  const requireLocal = name => name === 'server-only' ? {} : name.startsWith('@/') ? load(name.slice(2) + '.ts') : nativeRequire(name);
  new Function('exports', 'require', 'module', code)(item.exports, requireLocal, item);
  return item.exports;
}
const original = { fetch: global.fetch, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, key: process.env.ANTHROPIC_API_KEY };
const { requestClaudeJson } = load('lib/claude-provider.ts');
const { AI_REQUEST_TIMEOUT_MS, AI_DETAIL_TIMEOUT_MS, AI_CLIENT_TIMEOUT_MS, AI_DETAIL_CLIENT_TIMEOUT_MS } = load('lib/ai-budget.ts');
const options = { system: 'Teach the supplied lesson.', payload: { topic: 'SQL grouping' }, schema: { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } }, maxTokens: 1000 };
const success = () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ answer: 'Count the rows in each group.' }) }] });
let now = 0, timerId = 0;
const timers = new Map();
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
async function advance(ms) {
  const target = now + ms;
  while (true) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
  }
  now = target; await flush();
}
async function rejects(promise, pattern, label) { await assert.rejects(promise, pattern); assertions++; check(true, label); }
(async () => {
  global.setTimeout = (callback, ms) => { const id = ++timerId; timers.set(id, { at: now + ms, callback }); return id; };
  global.clearTimeout = id => timers.delete(id);
  process.env.ANTHROPIC_API_KEY = 'OFFLINE-TEST-KEY';
  equal(AI_REQUEST_TIMEOUT_MS, 60_000, 'Cold schema compilation has a full minute');
  check(AI_CLIENT_TIMEOUT_MS > AI_REQUEST_TIMEOUT_MS, 'Browser outlives server generation');
  check(AI_DETAIL_CLIENT_TIMEOUT_MS > AI_DETAIL_TIMEOUT_MS, 'Detailed lesson browser deadline outlives server');

  let calls = 0, release;
  global.fetch = (url, init) => {
    calls++;
    equal(url, 'https://api.anthropic.com/v1/messages', 'Provider endpoint stays fixed');
    equal(init.headers['anthropic-version'], '2026-10-21', 'Current provider API version');
    equal(JSON.parse(init.body).thinking, { type: 'between_tools' }, 'No up-front thinking delay');
    return new Promise((resolve, reject) => {
      release = () => resolve(success());
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };
  const first = requestClaudeJson(options), duplicate = requestClaudeJson(options);
  equal(calls, 1, 'Simultaneous identical actions share one provider generation');
  await advance(30_000); // Longer than every previous curriculum/lesson/tutor deadline.
  check(timers.size === 1, 'Cold generation remains active beyond the old deadline');
  release();
  equal(await first, await duplicate, 'Both callers receive the cold generation result');
  equal(timers.size, 0, 'Completed work clears deadline timers');
  global.fetch = async () => { calls++; return success(); };
  await requestClaudeJson(options);
  equal(calls, 2, 'Completed learner responses are not retained in a server cache');

  calls = 0;
  global.fetch = async () => { calls++; return calls === 1 ? new Response(null, { status: 529, headers: { 'Retry-After': '0' } }) : success(); };
  const recovered = requestClaudeJson(options);
  await flush(); await advance(0); await recovered;
  equal(calls, 2, 'One action recovers from a transient overload without another click');

  calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 529, headers: { 'Retry-After': '0' } }); };
  const overloaded = rejects(requestClaudeJson(options), /AI generation is unavailable/, 'Persistent overload remains bounded');
  await flush(); await advance(0); await overloaded;
  equal(calls, 2, 'At most one failed-HTTP retry is allowed');

  calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '30' } }); };
  await rejects(requestClaudeJson(options), /too many requests/, 'Long rate limits return a useful error');
  equal(calls, 1, 'A long Retry-After is honored without retrying too early');

  calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 401 }); };
  await rejects(requestClaudeJson(options), /authenticate/, 'Invalid credentials explain the configuration problem');
  equal(calls, 1, 'Authentication failures are not replayed');

  calls = 0;
  global.fetch = async () => { calls++; return new Response('PRIVATE_PROVIDER_RESPONSE'); };
  await rejects(requestClaudeJson(options), /AI generation is unavailable/, 'Malformed output becomes a safe error');
  equal(calls, 1, 'A potentially billed malformed completion is not replayed');

  calls = 0;
  global.fetch = async () => { calls++; throw new Error('PRIVATE_NETWORK_DETAIL'); };
  await rejects(requestClaudeJson(options), /AI generation is unavailable/, 'Network details remain private');
  equal(calls, 1, 'An ambiguous network failure is not replayed');

  calls = 0;
  global.fetch = (_url, init) => { calls++; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })); };
  const stalled = requestClaudeJson(options);
  const rejected = rejects(stalled, /took too long/, 'A stalled provider remains bounded');
  await advance(AI_REQUEST_TIMEOUT_MS); await rejected;
  equal(calls, 1, 'A timed-out completion is not replayed');

  const controller = new AbortController();
  const canceled = requestClaudeJson({ ...options, signal: controller.signal });
  const canceledRejection = rejects(canceled, /AI generation is unavailable/, 'Canceling background generation ends its provider request');
  controller.abort(); await canceledRejection;
  equal(timers.size, 0, 'Cancellation clears the provider deadline');

  global.fetch = async () => new Response('x'.repeat(129 * 1024));
  await rejects(requestClaudeJson(options), /AI generation is unavailable/, 'Streamed provider body stays bounded');

  const { generateClaudePlan } = load('lib/claude-plan.ts');
  const profile = { id: 'offline-learner', name: 'Alex', background: 'Statistics', experience: 'Customer reporting', skills: ['Excel'], goals: 'Learn Python data analysis', availableStudyTime: 5, track: 'data-science' };
  const draft = {
    title: 'Python analysis', summary: 'Build and apply Python foundations.', skippedMaterial: 'Advanced deployment is outside this path.',
    modules: ['Variables', 'Customer data', 'Exploration', 'Validation'].map((title, index) => ({
      title, description: 'Practice beginner Python with customer data.', inclusionReason: 'Develop the required analysis foundation.',
      topics: ['Python basics', `Analysis step ${index + 1}`], estimatedDuration: 60,
      prerequisites: index ? [index - 1] : [], resourceIds: ['harvard-python'],
    })),
  };
  let resourceCalls = 0, providerCalls = 0;
  global.fetch = async url => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      providerCalls++;
      check(resourceCalls > 0, 'Academic checks start before generation, rather than afterward');
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }] });
    }
    resourceCalls++;
    return new Response('Academic reading', { headers: { 'Content-Type': 'text/html' } });
  };
  await generateClaudePlan(profile);
  const firstResourceCalls = resourceCalls;
  await generateClaudePlan(profile);
  equal(resourceCalls, firstResourceCalls, 'Successful fixed catalog checks are reused across plans');
  equal(providerCalls, 2, 'Each completed plan request still generates its own curriculum');

  const { MAX_MODULE_DURATION_MINUTES, curriculumMinuteBudget } = load('lib/curriculum-budget.ts');
  const { assertModule, parseLessonRequest } = load('lib/validators.ts');
  equal(MAX_MODULE_DURATION_MINUTES, 28_800, 'The shared module ceiling matches the largest supported twelve-week study budget');
  const advancedProfile = { ...profile, availableStudyTime: 40 };
  let providerDraft = structuredClone(draft);
  providerDraft.modules.forEach(module => { module.estimatedDuration = 5000; });
  global.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.anthropic.com/'))
      return new Response('Academic reading', { headers: { 'Content-Type': 'text/html' } });
    const body = JSON.parse(init.body), payload = JSON.parse(body.messages[0].content);
    equal(payload.studyBudget, { weeks: 12, totalMinutes: 28_800 }, 'Claude receives an explicit numeric total workload budget');
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(providerDraft) }] });
  };
  const advanced = await generateClaudePlan(advancedProfile);
  equal(advanced.modules.map(module => module.estimatedDuration), [5000, 5000, 5000, 5000], 'Valid advanced modules above the former forty-hour ceiling retain their realistic durations');
  check(advanced.modules.reduce((sum, module) => sum + module.estimatedDuration, 0) <= curriculumMinuteBudget(40), 'The whole advanced plan still fits the learner budget');
  providerDraft.modules.forEach((module, index) => { module.estimatedDuration = [11_000, 5000, 4000, 4000][index]; });
  const concentrated = await generateClaudePlan(advancedProfile);
  equal(parseLessonRequest({ module: concentrated.modules[0] }).module.estimatedDuration, 11_000, 'A valid advanced module above the former shared ten-thousand-minute ceiling reaches lesson requests unchanged');
  assertModule({ ...concentrated.modules[0], estimatedDuration: MAX_MODULE_DURATION_MINUTES }); assertions++;
  assert.throws(() => assertModule({ ...concentrated.modules[0], estimatedDuration: MAX_MODULE_DURATION_MINUTES + 1 })); assertions++;
  for (const [duration, label] of [[28_801, 'A module above the global supported budget'], [5000.5, 'A noninteger generated duration'], [29, 'A generated duration below thirty minutes']]) {
    providerDraft = structuredClone(draft);
    providerDraft.modules[0].estimatedDuration = duration;
    await rejects(generateClaudePlan(advancedProfile), /study plan that could not be validated/, `${label} is still rejected`);
  }
  providerDraft = structuredClone(draft);
  providerDraft.modules.forEach(module => { module.estimatedDuration = 8000; });
  await rejects(generateClaudePlan(advancedProfile), /study plan that could not be validated/, 'A plan whose sum exceeds forty hours per week for twelve weeks is still rejected');

  delete process.env.ANTHROPIC_API_KEY;
  global.fetch = async () => { throw new Error('Unconfigured mode must not call the provider'); };
  equal(await requestClaudeJson(options), null, 'Unconfigured mode stays explicit');
  console.log(`PASS ${assertions} AI request assertions: cold-schema deadlines, coalescing, bounded overload recovery, cancellation, safe failures, and no completion replay.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = original.fetch; global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout;
  if (original.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = original.key;
});
