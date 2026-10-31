/* eslint-disable @typescript-eslint/no-require-imports */
/** Guest-library migration and independent saved-progress regressions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), cache = new Map();
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (value, label) => { assert.ok(value, label); assertions++; };
const clone = value => JSON.parse(JSON.stringify(value));
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const nativeRequire = Module.createRequire(filename);
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : name.startsWith('@/') ? load(name.slice(2) + '.ts') : nativeRequire(name), item, item.exports);
  return item.exports;
}
const { loadGuestLibrary, writeGuestLibrary, summaryForPath, GUEST_LIBRARY_KEY } = load('lib/learning-library.ts');
const { DEMO_PROFILE, createMockPlan } = load('lib/mock-data.ts');
const { generateLesson } = load('lib/ai.ts');
function storage(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = [], reads = [];
  return { values, writes, reads, getItem(key) { reads.push(key); return values.get(key) ?? null; }, setItem(key, value) { writes.push({ key, value }); values.set(key, value); } };
}

(async () => {
  const profile = clone(DEMO_PROFILE), plan = createMockPlan(profile), learningModule = plan.modules[0];
  const lesson = (await generateLesson({ module: learningModule })).lesson;
  const result = { lessonId: lesson.id, moduleId: learningModule.id, score: 100, correctAnswers: lesson.quiz.length, totalQuestions: lesson.quiz.length, passed: true, completedAt: '2026-10-31T18:00:00.000Z', questions: clone(lesson.quiz) };
  const state = { version: 1, profile, plan, lessons: { [learningModule.id]: lesson }, quizResults: { [learningModule.id]: result }, planMode: 'mock', lessonModes: { [learningModule.id]: 'mock' }, planGeneration: 'migration-test-generation' };
  const original = JSON.stringify(state);
  const legacy = storage({ 'ownpath:learning:v1': original });
  const migrated = loadGuestLibrary(legacy);
  equal(migrated.version, 2, 'Legacy progress migrates to a version-2 library');
  equal(migrated.paths.length, 1, 'Migration creates exactly one saved learning path');
  check(/^[a-f0-9-]{36}$/u.test(migrated.activePathId), 'Migrated paths receive an opaque UUID independent of curriculum IDs');
  equal(legacy.values.get('ownpath:learning:v1'), original, 'The legacy backup key remains unchanged');
  equal(migrated.paths[0].state.lessons[learningModule.id], lesson, 'Migration preserves the saved lecture and assessment');
  equal(migrated.paths[0].state.quizResults[learningModule.id], result, 'Migration preserves the best recorded quiz result');
  equal(migrated.paths[0].state.plan.modules[0].status, 'completed', 'Migration reconciles saved passing progress');
  equal(summaryForPath(migrated.paths[0]).completedModuleCount, 1, 'Path metadata reflects the saved completion');
  const restored = loadGuestLibrary(legacy);
  equal(restored.activePathId, migrated.activePathId, 'A repeated load reuses the same migrated path ID');
  equal(restored.paths.length, 1, 'A repeated load does not duplicate the legacy path');

  const fresh = storage({ [GUEST_LIBRARY_KEY]: JSON.stringify({ version: 2, activePathId: null, paths: [] }), 'ownpath:learning:v1': original });
  equal(loadGuestLibrary(fresh), { version: 2, activePathId: null, paths: [] }, 'An existing empty library does not resurrect deleted legacy progress');
  equal(fresh.reads, [GUEST_LIBRARY_KEY], 'A version-2 library takes precedence without reading the legacy backup');

  const second = { id: 'another-opaque-id', updatedAt: '2026-10-31T19:00:00.000Z', state: clone(state) };
  second.state.quizResults = {}; second.state.planGeneration = 'independent-path-generation';
  const twoPaths = { version: 2, activePathId: second.id, paths: [migrated.paths[0], second] };
  writeGuestLibrary(legacy, twoPaths);
  const independent = loadGuestLibrary(legacy);
  equal(independent.paths.length, 2, 'Several paths can share the same track, profile, and deterministic catalog plan');
  equal(independent.activePathId, second.id, 'The selected saved path survives reload');
  equal(summaryForPath(independent.paths[0]).completedModuleCount, 1, 'The first path retains its completion');
  equal(summaryForPath(independent.paths[1]).completedModuleCount, 0, 'The second path has independent progress');
  equal(summaryForPath(independent.paths[1]), { id: second.id, title: plan.title, track: plan.track, profileName: profile.name, moduleCount: plan.modules.length, completedModuleCount: 0, updatedAt: second.updatedAt }, 'A summary carries the selected path identity and truthful metadata');
  writeGuestLibrary(legacy, { ...independent, activePathId: null });
  equal(loadGuestLibrary(legacy).activePathId, null, 'Starting a new draft can leave saved paths intact with no active path');

  const warnings = [];
  const damaged = storage({ [GUEST_LIBRARY_KEY]: JSON.stringify({ version: 2, activePathId: 'damaged', paths: [
    { id: 'damaged', state: {}, updatedAt: '2026-10-31T18:00:00.000Z' }, migrated.paths[0],
    { ...second, updatedAt: 'yesterday' }, clone(migrated.paths[0]), null,
  ] }) });
  const salvaged = loadGuestLibrary(damaged, message => warnings.push(message));
  equal(salvaged.paths.map(path => path.id), [migrated.paths[0].id], 'Invalid and duplicate entries cannot hide a valid saved path');
  equal(salvaged.activePathId, migrated.paths[0].id, 'A damaged active path falls back to an available saved path');
  check(warnings.length > 0 && warnings.every(message => typeof message === 'string'), 'Recoverable cache damage produces a user-facing warning');
  for (const invalid of [null, [], {}, { version: 1, activePathId: null, paths: [] }, { version: 2, activePathId: 5, paths: [] }, { version: 2, activePathId: null, paths: {} }]) {
    const source = storage({ [GUEST_LIBRARY_KEY]: JSON.stringify(invalid), 'ownpath:learning:v1': original });
    assert.throws(() => loadGuestLibrary(source), /library/); assertions++;
    equal(source.writes.length, 0, 'A malformed envelope is not silently replaced or migrated over');
  }
  assert.throws(() => loadGuestLibrary(storage({ [GUEST_LIBRARY_KEY]: '{broken' })), /unreadable/); assertions++;
  const before = legacy.values.get(GUEST_LIBRARY_KEY);
  for (const invalid of [{ ...twoPaths, activePathId: 'missing' }, { ...twoPaths, paths: [second, second] }, { ...twoPaths, paths: [{ ...second, state: {} }] }]) {
    assert.throws(() => writeGuestLibrary(legacy, invalid)); assertions++;
    equal(legacy.values.get(GUEST_LIBRARY_KEY), before, 'A failed write leaves the prior saved library intact');
  }
  const full = storage({ 'ownpath:learning:v1': original }); full.setItem = () => { throw new Error('Quota exceeded'); };
  const quotaWarnings = [];
  const memoryOnly = loadGuestLibrary(full, message => quotaWarnings.push(message));
  equal(memoryOnly.paths.length, 1, 'A migration storage failure still restores progress in memory');
  check(quotaWarnings.length === 1, 'A migration storage failure explains that browser persistence is unavailable');
  equal(loadGuestLibrary(storage()), { version: 2, activePathId: null, paths: [] }, 'A new browser begins with an empty guest library');
  console.log(`PASS ${assertions} guest library assertions: one-time migration, independent paths, saved assessment progress, cache recovery, and safe writes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
