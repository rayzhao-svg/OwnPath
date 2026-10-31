/* eslint-disable @typescript-eslint/no-require-imports */
/** Actual HTTP account journey. Run only against an isolated mock-mode server. */
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const origin = new URL(process.env.BASE_URL || 'http://127.0.0.1:3006');
assert(['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash,
  'BASE_URL must be an HTTP(S) server origin without credentials or a path.');
const base = origin.origin, suffix = randomUUID(), password = randomBytes(24).toString('base64url');
let assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const equal = (value, expected, label) => { assert.deepEqual(value, expected, label); assertions++; };
const clone = value => structuredClone(value);
async function request(method, endpoint, { body, jar, expected = 200, accountId, headers: extra = {} } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: {
      Origin: base, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(jar?.cookie ? { Cookie: jar.cookie } : {}),
      ...(accountId ?? (endpoint.startsWith('/api/account/') ? jar?.user?.id : undefined)
        ? { 'X-OwnPath-Account': accountId ?? jar.user.id } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  equal(response.status, expected, `${method} ${endpoint}: HTTP status`);
  const data = await response.json();
  check(!JSON.stringify(data).includes(password) && !JSON.stringify(data).includes('password_hash'), 'Account responses never contain password material');
  if (/^\/api\/(?:auth|account)\//.test(endpoint))
    equal(response.headers.get('cache-control'), 'private, no-store', 'Account HTTP responses are private and uncacheable');
  const setCookie = response.headers.get('set-cookie');
  if (jar && setCookie) {
    check(setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'), 'HTTP session cookies have the required browser protections');
    jar.cookie = setCookie.split(';')[0];
  }
  return data;
}
async function register(label) {
  const jar = { cookie: '', user: null, email: `${label}.${suffix}@example.invalid` };
  const data = await request('POST', '/api/auth/register', { jar, body: { name: `Synthetic ${label}`, email: jar.email, password }, expected: 201 });
  jar.user = data.user;
  check(typeof jar.user.id === 'string' && jar.user.id.length > 0, 'A real HTTP registration returns a public account identity');
  check(jar.cookie.startsWith('ownpath_session='), 'Registration establishes the private HTTP cookie jar');
  return jar;
}
async function completedState(direction, jar) {
  const profile = {
    id: randomUUID(), name: 'Synthetic HTTP learner', background: 'Algebra and practical project work', experience: 'Weekly analysis and coding practice',
    skills: ['Python', 'Spreadsheets'], goals: direction === 'data-science' ? 'Analyze customer retention with Python' : 'Build an accessible project dashboard',
    availableStudyTime: 5, track: direction,
  };
  const planned = await request('POST', '/api/plan', { jar, body: { profile } });
  equal(planned.mode, 'mock', 'The account HTTP journey requires an isolated mock-mode curriculum server');
  const learningModule = planned.plan.modules.find(module => module.status === 'not-started');
  const taught = await request('POST', '/api/lesson', { jar, body: { module: learningModule } });
  equal(taught.mode, 'mock', 'The HTTP journey uses real mock lesson routes without provider charges');
  const fresh = await request('POST', '/api/quiz', { jar, body: {
    lesson: taught.lesson, previousQuestions: taught.lesson.quiz.map(question => question.question), questionCount: 5,
  } });
  equal(fresh.mode, 'mock', 'The HTTP journey uses the actual mock quiz generator');
  equal(fresh.quiz.length, 5, 'The saved assessment has the supported five-question minimum');
  const lesson = { ...taught.lesson, quiz: fresh.quiz };
  const answers = Object.fromEntries(lesson.quiz.map(question => [question.id, question.correctAnswer]));
  const result = {
    lessonId: lesson.id, moduleId: lesson.moduleId, answers, questions: clone(lesson.quiz), missedQuestionIds: [],
    correctAnswers: 5, totalQuestions: 5, score: 100, passed: true, completedAt: new Date().toISOString(),
  };
  return {
    version: 1, profile, plan: planned.plan, planGeneration: randomUUID(), planMode: planned.mode,
    lessons: { [learningModule.id]: lesson }, lessonModes: { [learningModule.id]: taught.mode },
    quizResults: { [learningModule.id]: result }, latestQuizResults: { [learningModule.id]: result },
    quizHistory: { [learningModule.id]: [result] }, remediations: {},
  };
}
(async () => {
  const alice = await register('account-a'), bob = await register('account-b');
  equal((await request('GET', '/api/auth/session', { jar: alice })).user.id, alice.user.id, 'The HTTP session endpoint restores its own account');
  const dataState = await completedState('data-science', alice), webState = await completedState('web-development', alice);
  const importKey = `guest-${suffix}`;
  const first = (await request('POST', '/api/account/tracks', { jar: alice, body: { state: dataState }, headers: { 'Idempotency-Key': importKey }, expected: 201 })).track;
  const second = (await request('POST', '/api/account/tracks', { jar: alice, body: { state: webState }, expected: 201 })).track;
  const third = (await request('POST', '/api/account/tracks', { jar: alice, body: { state: dataState }, expected: 201 })).track;
  check(first.id !== third.id, 'Two saved paths in the same direction have independent record identities');
  const list = (await request('GET', '/api/account/tracks', { jar: alice })).tracks;
  equal(list.length, 3, 'Three real HTTP track records coexist in one account');
  equal(list.filter(track => track.track === 'data-science').length, 2, 'The library retains multiple paths in one direction');
  equal(list.filter(track => track.track === 'web-development').length, 1, 'The library also retains a different direction');
  check(list.every(track => track.completedModuleCount === 1), 'All saved path summaries preserve completed assessments');
  for (const record of [second, first, third, second]) {
    const loaded = (await request('GET', `/api/account/tracks/${record.id}`, { jar: alice })).track;
    equal(loaded.state.plan.track, record.state.plan.track, 'Switching records restores that path direction');
    const moduleId = loaded.state.plan.modules[0].id;
    equal(loaded.state.plan.modules[0].status, 'completed', 'Switching paths restores the completed module');
    equal(loaded.state.plan.modules[1].status, 'not-started', 'Switching paths preserves prerequisite unlocking');
    equal(loaded.state.quizHistory[moduleId][0].score, 100, 'Switching paths preserves the completed grade');
    equal(loaded.state.quizHistory[moduleId][0].questions.length, 5, 'Question snapshots remain attached to their saved attempt');
    equal(loaded.state.lessons[moduleId].quiz, loaded.state.quizHistory[moduleId][0].questions, 'Saved teaching and the current assessment stay aligned');
  }
  equal((await request('GET', '/api/account/tracks', { jar: bob })).tracks, [], 'Another account cannot see the first account library');
  await request('GET', `/api/account/tracks/${first.id}`, { jar: bob, expected: 404 });
  await request('PUT', `/api/account/tracks/${first.id}`, { jar: bob, body: { state: dataState, revision: 1 }, expected: 404 });
  await request('DELETE', `/api/account/tracks/${first.id}`, { jar: bob, body: { revision: 1 }, expected: 404 });
  await request('POST', '/api/account/tracks', { jar: bob, accountId: alice.user.id, body: { state: dataState }, expected: 409 });
  await request('GET', '/api/account/tracks', { jar: bob, accountId: alice.user.id, expected: 409 });

  const updatedState = clone(first.state);
  updatedState.plan.title = `HTTP persisted revision ${suffix.slice(0, 8)}`;
  const updated = (await request('PUT', `/api/account/tracks/${first.id}`, { jar: alice, body: { state: updatedState, revision: first.revision } })).track;
  equal(updated.revision, first.revision + 1, 'A real HTTP save advances the compare-and-swap revision');
  await request('PUT', `/api/account/tracks/${first.id}`, { jar: alice, body: { state: first.state, revision: first.revision }, expected: 409 });
  equal((await request('GET', `/api/account/tracks/${first.id}`, { jar: alice })).track.state.plan.title, updatedState.plan.title, 'A stale HTTP save cannot overwrite newer progress');
  const retried = (await request('POST', '/api/account/tracks', { jar: alice, body: { state: dataState }, headers: { 'Idempotency-Key': importKey }, expected: 201 })).track;
  equal(retried.id, first.id, 'An import retry resolves to the original HTTP track record');
  equal(retried.revision, updated.revision, 'An import retry preserves the newer revision');
  equal(retried.state.plan.title, updatedState.plan.title, 'An import retry preserves progress saved after the original import');
  equal((await request('GET', '/api/account/tracks', { jar: alice })).tracks.length, 3, 'Idempotent imports do not create duplicate saved paths');
  const originalCookie = alice.cookie;
  await request('POST', '/api/auth/logout', { jar: alice, accountId: alice.user.id, body: {} });
  equal((await request('GET', '/api/auth/session', { jar: alice })).user, null, 'Signing out clears the real HTTP session');
  await request('GET', '/api/account/tracks', { jar: alice, expected: 401 });
  equal((await request('GET', '/api/auth/session', { jar: { cookie: originalCookie } })).user, null, 'The old signed-out cookie is revoked on the server');
  const signedIn = await request('POST', '/api/auth/login', { jar: alice, body: { email: alice.email, password } });
  equal(signedIn.user.id, alice.user.id, 'Signing back in restores the same account identity');
  const restored = (await request('GET', `/api/account/tracks/${first.id}`, { jar: alice })).track;
  equal(restored.state.plan.title, updatedState.plan.title, 'Reauthentication restores the latest durable curriculum state');
  const savedModule = restored.state.plan.modules[0].id;
  equal(restored.state.quizHistory[savedModule], first.state.quizHistory[savedModule], 'Reauthentication preserves exact completed attempt history and question snapshots');
  equal((await request('GET', '/api/account/tracks', { jar: alice })).tracks.length, 3, 'All path records remain available after a fresh login');
  equal((await request('GET', '/api/auth/session', { jar: bob })).user.id, bob.user.id, 'One account sign-out and sign-in does not disturb the other account session');
  await request('POST', '/api/auth/logout', { jar: alice, accountId: alice.user.id, body: {} });
  await request('POST', '/api/auth/logout', { jar: bob, accountId: bob.user.id, body: {} });
  console.log(`PASS ${assertions} actual HTTP account assertions: two accounts, three independent paths, real lessons/quizzes, completed history, switching, reauthentication, owner isolation, CAS, and idempotent import.`);
  console.log('Only synthetic accounts were created on the isolated server. Cookies and credentials were kept private; all generation responses were mock mode.');
})().catch(error => { console.error(error instanceof Error ? error.message : 'Account HTTP journey failed.'); process.exitCode = 1; });
