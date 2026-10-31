/* eslint-disable @typescript-eslint/no-require-imports */
/** Exercise the real workspace and controlled learning handlers with isolated storage. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let assertions = 0, rendering;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const equal = (value, expected, label) => { assert.deepEqual(value, expected, label); assertions++; };
const clone = value => structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };
const jsx = (type, props, key) => ({ type, props, key });
const react = {
  createContext: () => ({ Provider: 'LearningContext' }), useContext: () => null,
  useState: (...args) => rendering.react.useState(...args), useRef: (...args) => rendering.react.useRef(...args),
  useEffect: (...args) => rendering.react.useEffect(...args), useCallback: (...args) => rendering.react.useCallback(...args),
  useMemo: (...args) => rendering.react.useMemo(...args),
};
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
function hooks() {
  const slots = []; let index = 0, effects = [];
  const runtime = {
    react: {
      useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useCallback(callback, dependencies) { const slot = index++, previous = slots[slot]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) slots[slot] = { callback, dependencies }; return slots[slot].callback; },
      useMemo(factory, dependencies) { const slot = index++, previous = slots[slot]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) slots[slot] = { value: factory(), dependencies }; return slots[slot].value; },
      useEffect(effect, dependencies) { const slot = index++, previous = slots[slot]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) effects.push(() => { previous?.cleanup?.(); slots[slot] = { dependencies, effect, cleanup: effect() }; }); },
    },
    render(component) { rendering = runtime; index = 0; const tree = component(), pending = effects; effects = []; pending.forEach(run => run()); return tree; },
    replay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  return runtime;
}
function clock() {
  const original = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let now = 0, id = 0;
  const timers = new Map();
  global.setTimeout = (callback, ms) => { const key = ++id; timers.set(key, { at: now + ms, callback }); return key; };
  global.clearTimeout = key => timers.delete(key);
  return {
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      now = end; await settle();
    },
    restore() { global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout; },
  };
}
function storage(seed = {}) {
  const data = new Map(Object.entries(seed)), writes = [];
  return { data, writes, getItem: key => data.get(key) ?? null, setItem(key, value) { writes.push(key); data.set(key, value); }, removeItem: key => data.delete(key) };
}
const { AccountApiError } = load('lib/account-client.ts');
const { createMockPlan } = load('lib/mock-data.ts');
const { summaryForPath, GUEST_LIBRARY_KEY, loadGuestLibrary } = load('lib/learning-library.ts');
const userA = { id: 'account-a', name: 'Alex', email: 'alex@example.test' }, userB = { id: 'account-b', name: 'Blair', email: 'blair@example.test' };
function fixture(label = 'one') {
  const profile = { id: 'same-learner', name: 'Alex', background: 'Statistics', experience: '', skills: ['Excel'], goals: `Analyze customer retention ${label}`, availableStudyTime: 40, track: 'data-science' };
  const plan = createMockPlan(profile); plan.id = 'shared-curriculum-id'; plan.title = `Customer learning ${label}`;
  const learningModule = plan.modules[0];
  const lesson = { id: `lesson-${label}`, moduleId: learningModule.id, title: learningModule.title,
    slides: [{ id: `slide-${label}`, title: 'Customer retention', bullets: ['Match the cohort and observation window.'], narration: 'Divide retained customers by the original customer cohort using one observation window.' }],
    quiz: Array.from({ length: 5 }, (_, index) => ({ id: `question-${label}-${index}`, question: `Which customer observation is consistent ${index + 1}?`, options: ['Same cohort', 'Ignore all dates', 'Different cohorts', 'No denominator'], correctAnswer: 0, explanation: 'Compare matching cohorts and observation windows.' })) };
  return { version: 1, profile, plan, lessons: { [learningModule.id]: lesson }, quizResults: {}, planGeneration: `generation-${label}`, planMode: 'mock', lessonModes: { [learningModule.id]: 'mock' } };
}
function passed(state) {
  const lesson = state.lessons[state.plan.modules[0].id];
  return { lessonId: lesson.id, moduleId: lesson.moduleId, correctAnswers: 5, totalQuestions: 5, score: 100, passed: true,
    completedAt: '2026-10-31T12:00:00.000Z', answers: Object.fromEntries(lesson.quiz.map(question => [question.id, 0])), missedQuestionIds: [], questions: clone(lesson.quiz) };
}
function backend(records = {}) {
  const byUser = new Map(Object.entries(records).map(([id, paths]) => [id, new Map(paths.map(record => [record.id, clone(record)]))]));
  const calls = [], custom = {}, imports = new Map(); let next = 0;
  const result = { byUser, calls, custom, userId: null };
  const verify = id => { if (id !== result.userId) throw new AccountApiError(409, 'The signed-in account changed.', 'ACCOUNT_CHANGED'); };
  const invoke = (kind, args, fallback) => { calls.push({ kind, args }); return custom[kind] ? custom[kind](...args) : fallback(); };
  const bucket = id => { if (!byUser.has(id)) byUser.set(id, new Map()); return byUser.get(id); };
  result.api = {
    AccountApiError,
    listAccountTracks: (...args) => invoke('list', args, async () => { const [id] = args; verify(id); return [...bucket(id).values()].map(record => ({ ...summaryForPath(record), revision: record.revision })); }),
    getAccountTrack: (...args) => invoke('get', args, async () => { const [owner, id] = args; verify(owner); const record = bucket(owner).get(id); if (!record) throw new AccountApiError(404, 'Path missing.'); return clone(record); }),
    createAccountTrack: (...args) => invoke('create', args, async () => {
      const [owner, state, , key] = args; verify(owner);
      if (key && imports.has(`${owner}:${key}`)) return clone(bucket(owner).get(imports.get(`${owner}:${key}`)));
      const record = { id: `created-${++next}`, revision: 1, updatedAt: new Date().toISOString(), state: clone(state) };
      bucket(owner).set(record.id, record); if (key) imports.set(`${owner}:${key}`, record.id); return clone(record);
    }),
    saveAccountTrack: (...args) => invoke('save', args, async () => {
      const [owner, id, state, revision] = args; verify(owner); const previous = bucket(owner).get(id);
      if (previous?.revision !== revision) throw new AccountApiError(409, 'The path changed elsewhere.', 'REVISION_CONFLICT');
      const record = { ...previous, revision: revision + 1, updatedAt: new Date().toISOString(), state: clone(state) };
      bucket(owner).set(id, record); return clone(record);
    }),
    deleteAccountTrack: (...args) => invoke('delete', args, async () => { const [owner, id, revision] = args; verify(owner); if (bucket(owner).get(id)?.revision !== revision) throw new AccountApiError(409, 'The path changed elsewhere.', 'REVISION_CONFLICT'); bucket(owner).delete(id); }),
  };
  return result;
}
const record = (id, state) => ({ id, revision: 1, updatedAt: '2026-10-31T12:00:00.000Z', state: clone(state) });
function harness({ user = null, status = user ? 'authenticated' : 'guest', store = storage(), server = backend() } = {}) {
  const workspaceRuntime = hooks(), beforeLogout = new Set(); let childRuntime, childKey, value, element, accountEpoch = 0;
  const account = { current: null };
  const registerBeforeLogout = handler => { beforeLogout.add(handler); return () => beforeLogout.delete(handler); };
  const logout = async () => { for (const handler of beforeLogout) await handler(); server.calls.push({ kind: 'logout', args: [] }); setAccount(null, 'guest'); };
  function setAccount(next, nextStatus = next ? 'authenticated' : 'guest') {
    server.userId = next?.id ?? null;
    account.current = { user: next, status: nextStatus, sessionEpoch: ++accountEpoch, error: null, registerBeforeLogout, logout };
  }
  setAccount(user, status);
  const overrides = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/lib/account-context': { useOptionalAccount: () => account.current }, '@/lib/account-client': server.api };
  const { LearningWorkspaceProvider } = load('lib/learning-workspace.tsx', overrides);
  global.window = { localStorage: store };
  const renderRoot = () => { global.window = { localStorage: store }; element = workspaceRuntime.render(() => LearningWorkspaceProvider({ children: null })); return element; };
  const render = () => {
    renderRoot();
    if (!childRuntime || childKey !== element.key) { childRuntime?.unmount(); childRuntime = hooks(); childKey = element.key; }
    value = childRuntime.render(() => element.type(element.props)).props.value;
    return value;
  };
  render();
  return { server, store, account, setAccount, render, renderRoot,
    async settle() { for (let index = 0; index < 6; index++) { await settle(); render(); } return value; },
    replay() { workspaceRuntime.replay(); childRuntime?.replay(); },
    unmount() { workspaceRuntime.unmount(); childRuntime?.unmount(); },
    get value() { return value; }, get element() { return element; },
  };
}

async function guestJourneys() {
  const first = fixture('legacy'), score = passed(first); first.quizResults[score.moduleId] = score;
  const store = storage({ 'ownpath:learning:v1': JSON.stringify(first) });
  const h = harness({ store });
  try {
    h.replay(); await h.settle();
    equal(h.value.paths.length, 1, 'Legacy browser progress migrates into one guest path');
    equal(h.value.state.quizResults[score.moduleId].score, 100, 'Legacy migration retains the passing assessment');
    equal(h.value.state.plan.modules[0].status, 'completed', 'Legacy migration retains completed modules');
    const firstId = h.value.activePathId;
    check(store.getItem('ownpath:learning:v1'), 'Migration retains the original version-one browser backup');
    const second = fixture('second');
    equal(first.plan.id, second.plan.id, 'Two goals deliberately share the old deterministic plan ID');
    await h.value.setPlan(second.profile, second.plan, 'mock'); await h.settle();
    equal(h.value.paths.length, 2, 'Creating another guest path preserves the existing path');
    const secondId = h.value.activePathId; check(secondId !== firstId, 'Saved path identity is independent of curriculum plan identity');
    const active = clone(h.value.state);
    // A lesson arrives after the newly created path; persist through the actual provider.
    h.value.saveLesson(second.lessons[second.plan.modules[0].id], 'mock', second.plan.id, active.planGeneration); await h.settle();
    h.value.recordQuizResult(passed(h.value.state), second.plan.id, active.planGeneration); await h.settle();
    await h.value.switchPath(firstId); await h.settle();
    equal(h.value.state.quizResults[score.moduleId].score, 100, 'Switching guest paths restores the earlier passing assessment');
    await h.value.switchPath(secondId); await h.settle();
    equal(h.value.state.quizResults[score.moduleId].score, 100, 'The second path retains its own scored quiz');
    const saved = loadGuestLibrary(store);
    equal(saved.activePathId, secondId, 'Guest selection is saved for the next reload');
    equal(saved.paths.length, 2, 'Both complete guest learning states remain stored');
    equal(h.server.calls.length, 0, 'Guest learning never calls account storage');
  } finally { h.unmount(); }
  const reloaded = harness({ store });
  try { await reloaded.settle(); equal(reloaded.value.activePathId, loadGuestLibrary(store).activePathId, 'Guest reload restores the last active path'); equal(reloaded.value.paths.length, 2, 'Guest reload retains every separate path'); }
  finally { reloaded.unmount(); }
}

async function accountJourneys() {
  const first = fixture('account-first'), second = fixture('account-second');
  const server = backend({ [userA.id]: [record('path-a', first), record('path-b', second)] });
  const store = storage({ [`ownpath:account:${userA.id}:active`]: 'path-b' });
  const listing = deferred(), hydration = deferred();
  server.custom.list = () => listing.promise; server.custom.get = () => hydration.promise;
  const h = harness({ user: userA, store, server }), timer = clock();
  try {
    h.replay(); await h.settle();
    equal(server.calls.filter(call => call.kind === 'list').length, 1, 'Strict Mode replay starts one live account-library load');
    check(!h.value.ready, 'Learning is gated until the account library has loaded');
    await timer.advance(3000); equal(server.calls.filter(call => call.kind === 'save').length, 0, 'Unhydrated account state cannot trigger autosave');
    listing.resolve([...server.byUser.get(userA.id).values()].map(path => ({ ...summaryForPath(path), revision: path.revision }))); await h.settle();
    equal(server.calls.find(call => call.kind === 'get').args[1], 'path-b', 'Account hydration selects the remembered path rather than the first summary');
    hydration.resolve(clone(server.byUser.get(userA.id).get('path-b'))); await h.settle();
    check(h.value.ready, 'Hydrated account learning becomes ready');
    equal(h.value.activePathId, 'path-b', 'The last account path becomes active');
    delete server.custom.list; delete server.custom.get;
    equal(server.calls.filter(call => call.kind === 'save').length, 0, 'Loading saved account data does not immediately rewrite it');
    h.value.recordQuizResult(passed(h.value.state), second.plan.id, second.planGeneration); await h.settle();
    await timer.advance(599); equal(server.calls.filter(call => call.kind === 'save').length, 0, 'Quiz progress uses debounced autosave');
    const saving = deferred(); server.custom.save = () => saving.promise;
    const switching = h.value.switchPath('path-a'); await settle();
    equal(server.calls.filter(call => call.kind === 'save').length, 1, 'Switching paths flushes queued quiz progress immediately');
    equal(server.calls.filter(call => call.kind === 'get').length, 1, 'A different path cannot load before the pending save finishes');
    const savedState = server.calls.find(call => call.kind === 'save').args[2];
    equal(savedState.quizResults[second.plan.modules[0].id].score, 100, 'The flushed snapshot contains the actual scored quiz');
    const acknowledged = { ...record('path-b', savedState), revision: 2 }; server.byUser.get(userA.id).set('path-b', acknowledged);
    saving.resolve(clone(acknowledged)); await switching; await h.settle();
    equal(h.value.activePathId, 'path-a', 'The selected path changes only after the previous progress is saved');
    equal(h.value.state.quizResults, {}, 'A different path does not inherit another path’s quiz result');
    delete server.custom.save;
    h.value.recordQuizResult(passed(h.value.state), first.plan.id, first.planGeneration); await h.settle();
    await h.value.logoutAccount();
    const transition = h.renderRoot();
    equal(transition.props.initialState.plan, null, 'The first guest render after logout contains no previous account state');
    equal(transition.props.workspace.paths, [], 'The first guest render after logout contains no previous account path summaries');
    await h.settle();
    equal(h.value.state.plan, null, 'Logout leaves account progress out of guest learning');
    check(server.calls.findIndex(call => call.kind === 'save' && call.args[1] === 'path-a') < server.calls.findIndex(call => call.kind === 'logout'), 'Logout flushes the active path before ending the session');
    check(!store.getItem(GUEST_LIBRARY_KEY), 'Private account learning is never copied into browser guest storage');
  } finally { h.unmount(); timer.restore(); }
  const reloaded = harness({ user: userA, store, server });
  try {
    await reloaded.settle();
    equal(reloaded.value.activePathId, 'path-a', 'Signing back in restores the last active account path');
    equal(reloaded.value.state.quizResults[first.plan.modules[0].id].score, 100, 'A fresh account workspace loads the flushed passing score from server storage');
  } finally { reloaded.unmount(); }
}

async function accountRaces() {
  const first = fixture('race-a'), second = fixture('race-b');
  second.planGeneration = first.planGeneration;
  const server = backend({ [userA.id]: [record('path-a', first), record('path-a2', first)], [userB.id]: [record('path-b', second)] });
  const h = harness({ user: userA, server });
  try {
    await h.settle();
    const staleProviderChange = h.element.props.onStateChange;
    const lookup = deferred(); server.custom.get = (owner, id) => owner === userA.id && id === 'path-a2' ? lookup.promise : Promise.resolve(clone(server.byUser.get(owner).get(id)));
    const oldSwitch = h.value.switchPath('path-a2'); const rejected = assert.rejects(oldSwitch, /account changed/); await settle();
    h.setAccount(userB);
    const transition = h.renderRoot();
    equal(transition.props.initialState.plan, null, 'Changing accounts cannot expose the prior account snapshot for even one render');
    equal(transition.props.workspace.paths, [], 'Changing accounts immediately hides prior account path summaries');
    check(!transition.props.isReady, 'An identity transition is gated before effect cleanup runs');
    await h.settle(); equal(h.value.activePathId, 'path-b', 'The newly signed-in account hydrates its own path');
    const bBefore = clone(server.byUser.get(userB.id).get('path-b'));
    staleProviderChange({ ...first, quizResults: { [first.plan.modules[0].id]: passed(first) } }); await h.settle();
    equal(server.byUser.get(userB.id).get('path-b'), bBefore, 'An old provider callback cannot save into a new account even when plan IDs and generation tokens match');
    equal(h.value.state.profile.goals, second.profile.goals, 'A stale previous-account provider cannot replace the active learner context');
    await h.value.newPath(); await h.settle();
    equal(h.value.activePathId, null, 'A stale action from another account does not block current-account actions');
    lookup.resolve(clone(server.byUser.get(userA.id).get('path-a2'))); await rejected; assertions++;
    await h.settle(); equal(h.value.syncError, null, 'A late previous-account action cannot display its error in the new account');
    equal(h.value.state.plan, null, 'A late previous-account path cannot replace the current account draft');
  } finally { h.unmount(); }

  const retryServer = backend({ [userA.id]: [record('path-a', first)] });
  const retry = harness({ user: userA, server: retryServer });
  try {
    await retry.settle();
    const pending = deferred(); retryServer.custom.save = () => pending.promise;
    retry.value.recordQuizResult(passed(retry.value.state), first.plan.id, first.planGeneration); await retry.settle();
    const oldRetry = retry.value.retrySync(); await settle();
    retry.setAccount(userB); retryServer.custom.list = async () => { throw new Error('New account hydration failed.'); };
    await retry.settle(); check(retry.value.syncError?.includes('New account hydration failed'), 'The current account hydration error is visible');
    pending.resolve({ ...record('path-a', first), revision: 2 }); await oldRetry.catch(() => {}); await retry.settle();
    check(retry.value.syncError?.includes('New account hydration failed'), 'A canceled previous-account retry cannot clear the new account error');
  } finally { retry.unmount(); }

  const deletionServer = backend({ [userA.id]: [record('path-a', first), record('uncached-a', first)], [userB.id]: [record('path-b', second)] });
  const deletion = harness({ user: userA, server: deletionServer });
  try {
    await deletion.settle();
    const lookup = deferred();
    deletionServer.custom.get = (owner, id) => id === 'uncached-a' ? lookup.promise : Promise.resolve(clone(deletionServer.byUser.get(owner).get(id)));
    const deleting = deletion.value.deletePath('uncached-a'); const rejection = assert.rejects(deleting, /account changed/); await settle();
    deletion.setAccount(userB); await deletion.settle();
    lookup.resolve(clone(deletionServer.byUser.get(userA.id).get('uncached-a'))); await rejection; assertions++;
    equal(deletionServer.calls.filter(call => call.kind === 'delete').length, 0, 'A stale delete lookup cannot issue a second request using the new account identity');
    check(deletionServer.byUser.get(userA.id).has('uncached-a'), 'Account changes leave the previously requested deletion untouched');
  } finally { deletion.unmount(); }
}

async function importAndConflictJourneys() {
  const first = fixture('guest-one'), second = fixture('guest-two');
  const guests = { version: 2, activePathId: 'guest-one', paths: [{ id: 'guest-one', state: first, updatedAt: '2026-10-31T12:00:00.000Z' }, { id: 'guest-two', state: second, updatedAt: '2026-10-31T12:00:00.000Z' }] };
  const store = storage({ [GUEST_LIBRARY_KEY]: JSON.stringify(guests) }), server = backend();
  const h = harness({ user: userA, store, server });
  try {
    await h.settle(); equal(h.value.guestTrackCount, 2, 'Signing in exposes browser paths as an explicit import choice');
    equal(server.calls.filter(call => call.kind === 'create').length, 0, 'Signing in does not automatically upload guest learning');
    const originalCreate = server.api.createAccountTrack; let failed = false;
    server.custom.create = async (owner, state, signal, key) => {
      if (key === 'guest-two' && !failed) { failed = true; throw new Error('Temporary second-path failure.'); }
      delete server.custom.create; const result = await originalCreate(owner, state, signal, key); server.custom.create = handler; return result;
    };
    const handler = server.custom.create;
    await assert.rejects(h.value.importGuestTracks(), /second-path/); assertions++;
    await h.settle(); equal(loadGuestLibrary(store).paths.map(path => path.id), ['guest-two'], 'A partial import removes only successfully saved guest paths');
    equal(h.value.paths.length, 1, 'The successfully imported path remains available after another import fails');
    await h.value.importGuestTracks(); await h.settle();
    equal(h.value.paths.length, 2, 'Retrying a partial import retains both independent paths');
    equal(loadGuestLibrary(store).paths, [], 'All guest paths are removed only after their own imports succeed');
    check(server.calls.filter(call => call.kind === 'create').every(call => ['guest-one', 'guest-two'].includes(call.args[3])), 'Every imported guest path uses its stable idempotency key');
    equal(new Set([...server.byUser.get(userA.id).values()].map(path => path.state.plan.id)).size, 1, 'Different imported paths may share a curriculum plan ID without overwriting each other');
  } finally { h.unmount(); }

  const ambiguousStore = storage({ [GUEST_LIBRARY_KEY]: JSON.stringify(guests) }), ambiguousServer = backend();
  const originalWrite = ambiguousStore.setItem;
  const ambiguous = harness({ user: userA, store: ambiguousStore, server: ambiguousServer });
  try {
    await ambiguous.settle(); let failNext = true;
    ambiguousStore.setItem = (key, value) => {
      if (key === GUEST_LIBRARY_KEY && failNext) { failNext = false; throw new Error('Browser storage temporarily unavailable.'); }
      originalWrite(key, value);
    };
    await assert.rejects(ambiguous.value.importGuestTracks(), /storage temporarily/); assertions++;
    await ambiguous.settle();
    equal(loadGuestLibrary(ambiguousStore).paths.length, 2, 'A successful server import followed by a browser write failure retains the original guest paths');
    equal(ambiguousServer.byUser.get(userA.id).size, 1, 'The first import already exists on the server after the browser write fails');
    await ambiguous.value.importGuestTracks(); await ambiguous.settle();
    equal(ambiguousServer.byUser.get(userA.id).size, 2, 'Retrying an ambiguously completed import reuses its idempotency key instead of creating a duplicate');
    equal(ambiguous.value.paths.length, 2, 'The workspace also retains exactly one summary per imported path');
  } finally { ambiguous.unmount(); }

  const state = fixture('conflict'), remote = record('remote-path', state), conflictServer = backend({ [userA.id]: [remote] });
  const conflict = harness({ user: userA, server: conflictServer }), timer = clock();
  try {
    await conflict.settle();
    conflictServer.byUser.get(userA.id).get(remote.id).revision = 2;
    conflict.value.recordQuizResult(passed(conflict.value.state), state.plan.id, state.planGeneration); await conflict.settle(); await timer.advance(600); await conflict.settle();
    check(conflict.value.syncError?.includes('recovered path'), 'A revision conflict offers an explicit recovered-copy retry');
    const remoteBefore = clone(conflictServer.byUser.get(userA.id).get(remote.id));
    await conflict.value.retrySync(); await conflict.settle();
    equal(conflictServer.byUser.get(userA.id).get(remote.id), remoteBefore, 'Recovered-copy retry never overwrites the remote version');
    equal(conflict.value.paths.length, 2, 'Recovered-copy retry keeps the remote and local versions');
    check(conflict.value.state.plan.title.endsWith('(recovered copy)'), 'The recovered path is clearly named');
    equal(conflict.value.state.quizResults[state.plan.modules[0].id].score, 100, 'The recovered path retains unsynced passing progress');
    conflictServer.userId = userB.id;
    conflict.value.startModule(conflict.value.state.plan.modules[1].id, state.plan.id, state.planGeneration); await conflict.settle(); await timer.advance(600); await conflict.settle();
    const before = conflictServer.calls.filter(call => call.kind === 'create').length;
    await assert.rejects(conflict.value.retrySync(), /account changed/); assertions++;
    equal(conflictServer.calls.filter(call => call.kind === 'create').length, before, 'An account mismatch can never fork one account’s learning into another account');
  } finally { conflict.unmount(); timer.restore(); }
}

(async () => {
  const oldWindow = global.window;
  try { await guestJourneys(); await accountJourneys(); await accountRaces(); await importAndConflictJourneys(); }
  finally { if (oldWindow === undefined) delete global.window; else global.window = oldWindow; }
  console.log(`PASS ${assertions} learning workspace assertions: independent guest/account paths, controlled quiz autosave, hydration isolation, last selection, logout flushing, stale account actions, partial imports, and recovered conflicts.`);
  console.log('Actual workspace and learning handlers ran with isolated memory storage and stubbed account transport.');
})().catch(error => { console.error(error); process.exitCode = 1; });
