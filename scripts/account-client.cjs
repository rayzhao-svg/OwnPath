/* eslint-disable @typescript-eslint/no-require-imports */
/** Account boundaries, serialized autosave, and session races without real accounts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const equal = (value, expected, label) => { assert.deepEqual(value, expected, label); assertions++; };
const clone = value => structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const jsx = (type, props) => ({ type, props });
function load(relative, overrides = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const nativeRequire = NativeModule.createRequire(filename);
  const requireLocal = name => name in overrides ? overrides[name] : name === 'server-only' ? {} : name.startsWith('@/')
    ? load(['.ts', '.tsx'].map(extension => name.slice(2) + extension).find(file => fs.existsSync(path.join(root, file))), overrides, cache)
    : nativeRequire(name);
  new Function('exports', 'require', 'module', code)(item.exports, requireLocal, item);
  return item.exports;
}
function virtualClock() {
  const original = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let now = 0, sequence = 0;
  const timers = new Map();
  global.setTimeout = (callback, delay) => { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; };
  global.clearTimeout = id => timers.delete(id);
  return {
    timers,
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      now = end; await settle();
    },
    restore() { global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout; },
  };
}
function fixtures() {
  const profile = { id: 'account-learner', name: 'Alex', background: 'Statistics', experience: '', skills: ['Excel'], goals: 'Analyze customer retention', availableStudyTime: 40, track: 'data-science' };
  const plan = load('lib/mock-data.ts').createMockPlan(profile);
  const state = { version: 1, profile, plan, lessons: {}, quizResults: {}, planGeneration: 'account-generation' };
  const userA = { id: 'user-a', name: 'Alex', email: 'alex@example.test' }, userB = { id: 'user-b', name: 'Blair', email: 'blair@example.test' };
  const saved = (id = 'path-a', revision = 1, learning = state) => ({ id, revision, updatedAt: '2026-10-31T12:00:00.000Z', state: learning });
  return { state, userA, userB, saved };
}

async function clientChecks({ state, userA, saved }) {
  const client = load('lib/account-client.ts');
  const originalFetch = global.fetch;
  let calls = [];
  try {
    global.fetch = async (url, options) => {
      check(fs.existsSync(path.join(root, 'app', url, 'route.ts')), 'Authentication client URLs match actual server route files');
      calls.push({ url, options }); return Response.json({ user: { ...userA, password: 'never-expose-this' } });
    };
    equal(await client.getSession(), userA, 'Session parsing exposes only the public account identity');
    equal(calls[0].options.credentials, 'same-origin', 'Account requests use the browser session cookie');
    equal(calls[0].options.cache, 'no-store', 'Account session responses bypass browser caching');
    await client.registerAccount({ name: userA.name, email: userA.email, password: 'synthetic-test-password' });
    equal(calls.at(-1).url, '/api/auth/register', 'Registration uses the implemented authentication endpoint');
    await client.loginAccount({ email: userA.email, password: 'synthetic-test-password' });
    equal(calls.at(-1).url, '/api/auth/login', 'Login uses the implemented authentication endpoint');
    global.fetch = async (url, options) => {
      equal(url, '/api/auth/logout', 'Logout uses the implemented authentication endpoint');
      check(fs.existsSync(path.join(root, 'app', url, 'route.ts')), 'The logout client URL matches its actual server route');
      equal(options.headers['X-OwnPath-Account'], userA.id, 'Logout binds the account shown in this tab');
      return Response.json({ user: null });
    };
    await client.logoutAccount(undefined, userA.id); assertions++;

    const large = clone(state), id = large.plan.modules[0].id;
    large.lessons[id] = { id: 'large-account-course', moduleId: id, title: large.plan.modules[0].title,
      slides: Array.from({ length: 12 }, (_, index) => ({ id: `chapter-${index}`, title: `Retention chapter ${index + 1}`, bullets: ['Compare customer cohorts.'], narration: 'Compare customer cohorts using a consistent observation window. '.repeat(350) })),
      quiz: Array.from({ length: 5 }, (_, index) => ({ id: `question-${index}`, question: `Which retention observation is consistent ${index + 1}?`, options: ['Same window', 'Different window', 'No counts', 'Ignore time'], correctAnswer: 0, explanation: 'Use the same customer observation window.' })) };
    check(new TextEncoder().encode(JSON.stringify(large)).byteLength > 64 * 1024, 'The stored account fixture exceeds AI endpoint request limits');
    global.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ track: saved('path-a', 1, large) }); };
    const created = await client.createAccountTrack(userA.id, large, undefined, 'stable-guest-import');
    equal(created.state.lessons[id], large.lessons[id], 'Account saves preserve the complete large course without AI context truncation');
    equal(calls.at(-1).options.headers['X-OwnPath-Account'], userA.id, 'Path requests bind the expected account identity');
    equal(calls.at(-1).options.headers['Idempotency-Key'], 'stable-guest-import', 'Guest imports carry their stable idempotency key');
    equal(JSON.parse(calls.at(-1).options.body), { state: large }, 'Path creation sends its complete learning state');
    await client.getAccountTrack(userA.id, 'path-a');
    equal(calls.at(-1).url, '/api/account/tracks/path-a', 'Path hydration addresses its opaque saved record');
    global.fetch = async () => Response.json({ track: saved('wrong-path') });
    await assert.rejects(client.getAccountTrack(userA.id, 'path-a'), /unreadable/); assertions++;
    global.fetch = async () => Response.json({ track: saved('path-a', 2) });
    equal((await client.saveAccountTrack(userA.id, 'path-a', state, 1)).revision, 2, 'An accepted save advances its revision');
    global.fetch = async () => Response.json({ track: saved('path-a', 1) });
    await assert.rejects(client.saveAccountTrack(userA.id, 'path-a', state, 1), /unreadable/); assertions++;
    for (const code of ['REVISION_CONFLICT', 'ACCOUNT_CHANGED']) {
      global.fetch = async () => Response.json({ error: { code, message: 'This path could not be saved safely.' } }, { status: 409 });
      await assert.rejects(client.saveAccountTrack(userA.id, 'path-a', state, 1), error => error instanceof client.AccountApiError && error.status === 409 && error.code === code); assertions++;
    }
    let oversizedCalls = 0;
    global.fetch = async () => { oversizedCalls++; throw new Error('Unexpected request'); };
    await assert.rejects(client.createAccountTrack(userA.id, { ...state, oversized: 'x'.repeat(8 * 1024 * 1024) }), /too large/); assertions++;
    equal(oversizedCalls, 0, 'Oversized progress is rejected before any account data is sent');
    const controller = new AbortController(); controller.abort();
    global.fetch = async (_url, options) => { check(options.signal.aborted, 'Caller cancellation reaches account transport'); throw options.signal.reason; };
    await assert.rejects(client.getSession(controller.signal)); assertions++;

    const clock = virtualClock();
    try {
      global.fetch = async (_url, options) => new Response(new ReadableStream({
        start(stream) { options.signal.addEventListener('abort', () => stream.error(options.signal.reason), { once: true }); },
      }));
      const stalled = client.getSession();
      const rejection = assert.rejects(stalled, error => error instanceof client.AccountApiError && error.status === 408);
      await settle(); await clock.advance(20_000); await rejection; assertions++;
      equal(clock.timers.size, 0, 'Account deadlines cover stalled response bodies and release their timer');
    } finally { clock.restore(); }
  } finally { global.fetch = originalFetch; }
}

async function syncChecks({ state, saved }) {
  const cache = new Map();
  const { createTrackSync } = load('lib/account-sync.ts', {}, cache);
  const { AccountApiError } = load('lib/account-client.ts', {}, cache);
  const clock = virtualClock(), requests = [], acknowledgments = [], errors = [];
  const save = (userId, id, learning, revision, signal) => {
    const pending = deferred(); requests.push({ userId, id, state: learning, revision, signal, ...pending }); return pending.promise;
  };
  let sync;
  try {
    sync = createTrackSync({ save, onSaved: (track, binding) => { acknowledgments.push(track); sync.bind(binding); }, onError: error => errors.push(error) });
    sync.schedule(state); await clock.advance(1000);
    equal(requests.length, 0, 'Unbound guest state never writes to an account');
    sync.bind({ userId: 'user-a', trackId: 'path-a', revision: 1 });
    const first = { ...state, edit: 1 }, second = { ...state, edit: 2 }, latest = { ...state, edit: 3 };
    sync.schedule(first); sync.schedule(second);
    await clock.advance(599); equal(requests.length, 0, 'Autosave waits for its debounce window');
    await clock.advance(1); equal(requests.length, 1, 'Repeated edits coalesce into one account write');
    equal(requests[0].state, second, 'Autosave sends the newest debounced state');
    sync.schedule(first); sync.schedule(latest); await clock.advance(600);
    equal(requests.length, 1, 'An in-flight write prevents parallel saves');
    requests[0].resolve(saved('path-a', 2, second)); await settle();
    equal(requests.length, 2, 'The newest pending edit saves after the earlier write settles');
    equal(requests[1].revision, 2, 'The next write uses the newly acknowledged revision');
    equal(requests[1].state, latest, 'Edits arriving during a save coalesce without being lost');
    const completion = sync.flush(); requests[1].resolve(saved('path-a', 3, latest)); await completion;
    equal(sync.binding.revision, 3, 'The active binding retains the last accepted revision');
    equal(sync.status, 'saved', 'Flushing waits for all pending learning progress');
    equal(acknowledgments.length, 2, 'Rebinding an acknowledged path does not cancel newer queued edits');

    sync.schedule(first); sync.bind({ userId: 'user-b', trackId: 'path-b', revision: 1 }); await clock.advance(1000);
    equal(requests.length, 2, 'An account switch discards the previous account debounce');
    sync.schedule(second); const oldSave = sync.flush(); await settle();
    equal(requests[2].userId, 'user-b', 'Every write carries the bound account identity');
    sync.bind({ userId: 'user-c', trackId: 'path-c', revision: 4 });
    check(requests[2].signal.aborted, 'An account switch aborts the previous in-flight transport');
    requests[2].resolve(saved('path-b', 2, second)); await oldSave;
    equal(acknowledgments.length, 2, 'A late previous-account response cannot acknowledge another account');
    equal(sync.binding, { userId: 'user-c', trackId: 'path-c', revision: 4 }, 'A stale response cannot replace the new account binding');

    sync.schedule(first); const conflicted = sync.flush(); await settle();
    requests[3].reject(new AccountApiError(409, 'Changed in another tab.', 'REVISION_CONFLICT'));
    await assert.rejects(conflicted, /Changed/); assertions++;
    equal(sync.status, 'conflict', 'Revision conflicts remain visible');
    sync.schedule(latest); await clock.advance(5000);
    equal(requests.length, 4, 'Conflicts stop automatic retries and preserve newer local edits');
    equal(errors.at(-1).code, 'REVISION_CONFLICT', 'Conflict callbacks preserve the precise server error code');
    const retry = sync.flush(); await settle();
    equal(requests[4].revision, 4, 'An explicit retry never guesses or overwrites a remote revision');
    equal(requests[4].state, latest, 'An explicit retry retains the newest unsaved state');
    requests[4].reject(new AccountApiError(409, 'Account changed.', 'ACCOUNT_CHANGED'));
    await assert.rejects(retry, /Account changed/); assertions++;
    equal(errors.at(-1).code, 'ACCOUNT_CHANGED', 'An account mismatch stays distinguishable from a path revision conflict');
    sync.dispose();
    equal(clock.timers.size, 0, 'Disposing a controller releases pending timers');
  } finally { sync?.dispose(); clock.restore(); }
}

function hooks() {
  const slots = []; let index = 0, effects = [];
  return {
    react: {
      createContext: () => ({ Provider: 'AccountProvider' }), useContext: () => null,
      useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useCallback(callback, dependencies) { const slot = index++, previous = slots[slot]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) slots[slot] = { callback, dependencies }; return slots[slot].callback; },
      useEffect(effect, dependencies) { const slot = index++, previous = slots[slot]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) effects.push(() => { previous?.cleanup?.(); slots[slot] = { dependencies, effect, cleanup: effect() }; }); },
    },
    render(component) { index = 0; const tree = component(); const pending = effects; effects = []; pending.forEach(run => run()); return tree; },
    replay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
async function contextChecks({ userA, userB }) {
  const originalWindow = global.window, events = new Map(), sessions = [], logins = [], order = [];
  global.window = { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) };
  const runtime = hooks();
  const api = {
    getSession(signal) { const task = deferred(); sessions.push({ signal, ...task }); return task.promise; },
    loginAccount(input, signal) { const task = deferred(); logins.push({ input, signal, ...task }); return task.promise; },
    registerAccount: async () => userA,
    logoutAccount: async () => { order.push('logout'); },
  };
  const { AccountProvider, useOptionalAccount } = load('lib/account-context.tsx', { react: runtime.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/lib/account-client': api });
  const render = () => runtime.render(() => AccountProvider({ children: null })).props.value;
  try {
    equal(useOptionalAccount(), useOptionalAccount(), 'Isolated learning tests receive one stable browser-only guest fallback');
    equal(render().status, 'loading', 'Account initialization gates learning hydration');
    runtime.replay(); await settle();
    equal(sessions.length, 1, 'Strict Mode replay creates only one initial session request');
    sessions[0].resolve(userA); await settle(); let current = render();
    equal(current.user, userA, 'A restored session exposes its account identity');
    equal(current.sessionEpoch, 1, 'Initial account identity establishes one session epoch');
    events.get('focus')(); await settle();
    equal(render().status, 'authenticated', 'Focus revalidation keeps a stable authenticated view');
    sessions[1].resolve(clone(userA)); await settle();
    equal(render().sessionEpoch, 1, 'Unchanged focus sessions do not reset learning state');
    events.get('pageshow')(); await settle();
    const login = render().login({ email: userB.email, password: 'synthetic-test-password' });
    check(sessions[2].signal.aborted, 'Signing in cancels a stale focus session check');
    await assert.rejects(render().login({ email: userA.email, password: 'synthetic-test-password' }), /already in progress/); assertions++;
    equal(logins.length, 1, 'Repeated authentication actions cannot race separate account changes');
    logins[0].resolve(userB); await login; sessions[2].resolve(userA); await settle(); current = render();
    equal(current.user, userB, 'A stale session response cannot replace a newly signed-in account');
    equal(current.sessionEpoch, 2, 'Switching accounts changes the session epoch');
    const removeFailure = current.registerBeforeLogout(async () => { throw new Error('Keep unsaved learning open.'); });
    await assert.rejects(current.logout(), /unsaved/); assertions++;
    equal(order, [], 'A failed progress flush prevents logout from losing unsaved work');
    equal(render().user, userB, 'A failed logout flush retains the current account');
    removeFailure();
    const flush = deferred();
    const removeFlush = render().registerBeforeLogout(async () => { order.push('flush'); await flush.promise; });
    const logout = render().logout(); await settle(); equal(order, ['flush'], 'Logout awaits saving the active learning path');
    flush.resolve(); await logout; equal(order, ['flush', 'logout'], 'The server session ends only after progress is saved');
    equal(render().status, 'guest', 'Successful logout restores guest account mode');
    equal(render().sessionEpoch, 3, 'Logout invalidates previous account learning requests');
    removeFlush();
    events.get('focus')(); await settle(); sessions[3].resolve(userA); await settle(); render();
    events.get('focus')(); await settle(); sessions[4].resolve(null); await settle();
    equal(render().user, null, 'A cross-tab logout is detected on focus');
    equal(render().sessionEpoch, 5, 'Cross-tab identity changes invalidate stale account work');
    runtime.unmount(); equal(events.size, 0, 'Unmount removes account session subscriptions');
  } finally { runtime.unmount(); if (originalWindow === undefined) delete global.window; else global.window = originalWindow; }
}

(async () => {
  const data = fixtures();
  await clientChecks(data); await syncChecks(data); await contextChecks(data);
  console.log(`PASS ${assertions} account client/sync assertions: large path requests, identity binding, exact revisions, debounced saves, cross-account cancellation, conflict preservation, session races, and logout flushing.`);
  console.log('Transport and account identities were stubbed; no real accounts, browser storage, or provider requests were changed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
