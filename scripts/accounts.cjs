/* eslint-disable @typescript-eslint/no-require-imports */
/** Real SQLite and route integration, using an isolated temporary account DB. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), NativeModule = require('node:module');
const cryptoModule = require('node:crypto');
const { createHash, randomBytes, scryptSync } = cryptoModule;
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript'), root = path.resolve(__dirname, '..'), modules = new Map();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ownpath-accounts-'));
const originalPath = process.env.OWNPATH_DATABASE_PATH;
process.env.OWNPATH_DATABASE_PATH = path.join(directory, 'accounts.sqlite');
let assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const equal = (value, expected, label) => { assert.deepEqual(value, expected, label); assertions++; };
const clone = value => structuredClone(value);
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const item = { exports: {} }; modules.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const native = NativeModule.createRequire(filename);
  const local = name => name === 'server-only' ? {} : name.startsWith('@/') ? load(name.slice(2) + '.ts') : native(name);
  new Function('require', 'module', 'exports', code)(local, item, item.exports);
  return item.exports;
}
const store = load('lib/account-store.ts');
const { MAX_ACCOUNT_STATE_BYTES } = load('lib/account-types.ts');
const password = 'Offline account test phrase!';
async function call(method, endpoint, body, account, extra = {}) {
  const headers = { Origin: 'http://localhost', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra };
  if (account?.cookie) headers.Cookie = account.cookie;
  if (account?.user && endpoint.startsWith('/api/account/')) headers['X-OwnPath-Account'] = account.user.id;
  const request = new Request(`http://localhost${endpoint}`, {
    method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const match = /^\/api\/account\/tracks\/([^/]+)$/.exec(endpoint);
  const relative = match ? 'app/api/account/tracks/[id]/route.ts' : `app${endpoint}/route.ts`;
  const response = await load(relative)[method](request, { params: Promise.resolve({ id: match?.[1] }) });
  const data = await response.json();
  equal(response.headers.get('cache-control'), 'private, no-store', 'Private account responses cannot be cached');
  check(!JSON.stringify(data).includes('password_hash') && !JSON.stringify(data).includes('password_salt'), 'Credential storage fields never reach API responses');
  return { status: response.status, data, headers: response.headers };
}
async function account(name, email) {
  const result = await call('POST', '/api/auth/register', { name, email, password });
  equal(result.status, 201, 'Registration creates an account');
  const cookie = result.headers.get('set-cookie');
  check(cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax') && cookie.includes('Max-Age=2592000'), 'Sessions use an HTTP-only thirty-day same-site cookie');
  equal(Object.keys(result.data.user).sort(), ['email', 'id', 'name'], 'Only public user fields are returned');
  return { user: result.data.user, cookie: cookie.split(';')[0] };
}
async function state(track = 'data-science', completed = true) {
  const profile = { id: `learner-${track}`, name: 'Synthetic learner', background: 'Mathematics', experience: 'Analysis practice', skills: ['Python'], goals: 'Build useful projects', availableStudyTime: 5, track };
  const plan = load('lib/mock-data.ts').createMockPlan(profile);
  const lesson = (await load('lib/ai.ts').generateLesson({ module: plan.modules[0] })).lesson;
  const result = {
    lessonId: lesson.id, moduleId: lesson.moduleId, correctAnswers: lesson.quiz.length, totalQuestions: lesson.quiz.length,
    score: 100, passed: true, completedAt: '2026-10-31T12:00:00.000Z', questions: clone(lesson.quiz),
    answers: Object.fromEntries(lesson.quiz.map(question => [question.id, question.correctAnswer])), missedQuestionIds: [],
  };
  return {
    version: 1, profile, plan, lessons: { [lesson.moduleId]: lesson }, lessonModes: { [lesson.moduleId]: 'mock' }, planMode: 'mock', planGeneration: 'offline-generation',
    quizResults: completed ? { [lesson.moduleId]: result } : {}, latestQuizResults: completed ? { [lesson.moduleId]: result } : {},
    quizHistory: completed ? { [lesson.moduleId]: [result] } : {}, remediations: {},
  };
}
(async () => {
  try {
    equal((await call('GET', '/api/auth/session')).data, { user: null }, 'A guest session is explicit');
    const alice = await account('Alice', 'Alice@Example.test'), bob = await account('Bob', 'bob@example.test');
    const previousMode = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const secureResponse = new Response();
      load('lib/account-http.ts').setAccountCookie(secureResponse, 'synthetic-token');
      check(secureResponse.headers.get('set-cookie').includes('; Secure'), 'Production cookies require a secure connection');
    } finally { if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode; }
    equal(alice.user.email, 'alice@example.test', 'Email identity is normalized consistently');
    equal((await call('GET', '/api/auth/session', undefined, alice)).data.user, alice.user, 'The session cookie restores the account');
    equal((await call('POST', '/api/auth/register', { name: 'Other', email: 'ALICE@example.test', password })).status, 409, 'Case variants cannot register a duplicate email');
    equal((await call('POST', '/api/auth/login', { email: alice.user.email, password: 'Incorrect account password!' })).status, 401, 'Wrong passwords cannot authenticate');
    equal((await call('POST', '/api/auth/login', { email: "x'OR'1'='1@example.test", password })).status, 401, 'Email values cannot alter the parameterized credential query');
    equal((await call('POST', '/api/auth/login', { email: 'missing@example.test', password })).data.error.message,
      (await call('POST', '/api/auth/login', { email: alice.user.email, password: 'Incorrect account password!' })).data.error.message, 'Unknown emails and wrong passwords have the same safe message');
    equal((await call('POST', '/api/auth/register', { name: 'Short', email: 'short@example.test', password: 'short' })).status, 400, 'A short password is rejected');
    equal((await call('POST', '/api/auth/register', { name: 'Invalid', email: 'not-an-email', password })).status, 400, 'Invalid email identity is rejected');
    equal((await call('POST', '/api/auth/login', { email: alice.user.email, password, extra: true })).status, 400, 'Unsupported account fields are rejected');
    equal((await call('POST', '/api/auth/login', '{bad-json')).status, 400, 'Malformed credential JSON is rejected');
    equal((await call('POST', '/api/auth/login', {}, undefined, { Origin: 'https://elsewhere.example' })).status, 403, 'Cross-origin credential changes are rejected');
    equal((await call('POST', '/api/auth/login', {}, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'Cross-site browser writes are rejected');
    equal((await call('POST', '/api/auth/login', {}, undefined, { 'Content-Type': 'text/plain' })).status, 415, 'Credential writes require JSON');

    const saved = await state();
    let result = await call('POST', '/api/account/tracks', { state: saved }, alice, { 'Idempotency-Key': 'guest-offline-one' });
    equal(result.status, 201, 'A reviewed guest path can be imported into an account');
    const first = result.data.track, id = first.id;
    equal(first.revision, 1, 'A new learning path starts at revision one');
    equal(first.state.plan.modules[0].status, 'completed', 'A passing result restores module completion');
    equal(first.state.plan.modules[1].status, 'not-started', 'Completed prerequisites keep the next module available');
    equal(first.state.quizHistory[saved.plan.modules[0].id], saved.quizHistory[saved.plan.modules[0].id], 'Question snapshots and assessment history survive account storage');
    const second = (await call('POST', '/api/account/tracks', { state: saved }, alice)).data.track;
    const third = (await call('POST', '/api/account/tracks', { state: await state('web-development', false) }, alice)).data.track;
    check(second.id !== first.id, 'Two paths can share deterministic mock plan IDs without overwriting each other');
    equal((await call('GET', '/api/account/tracks', undefined, alice)).data.tracks.length, 3, 'An account can retain multiple paths, including two in the same direction');
    equal((await call('GET', '/api/account/tracks', undefined, bob)).data.tracks, [], 'Another account starts with its own empty library');
    const metadata = (await call('GET', '/api/account/tracks', undefined, alice)).data.tracks.find(track => track.id === id);
    equal(metadata.completedModuleCount, 1, 'Library metadata reports saved completion');
    equal(metadata.profileName, saved.profile.name, 'Library metadata identifies the learner profile');
    check(!('state' in metadata), 'The library list does not download every full course');
    equal((await call('GET', `/api/account/tracks/${id}`, undefined, bob)).status, 404, 'Knowing another account path ID does not reveal it');
    equal((await call('PUT', `/api/account/tracks/${id}`, { state: saved, revision: 1 }, bob)).status, 404, 'Another account cannot update a known path ID');
    equal((await call('DELETE', `/api/account/tracks/${id}`, { revision: 1 }, bob)).status, 404, 'Another account cannot delete a known path ID');
    equal((await call('GET', '/api/account/tracks')).status, 401, 'Saved paths require a session');
    equal((await call('GET', '/api/account/tracks', undefined, { cookie: alice.cookie })).status, 400, 'Saved path reads require an expected account ID');
    const staleAliceTab = { user: alice.user, cookie: bob.cookie };
    equal((await call('GET', '/api/account/tracks', undefined, staleAliceTab)).status, 409, 'A cookie switched in another tab cannot leak the new account library to the old account view');
    equal((await call('POST', '/api/account/tracks', { state: saved }, staleAliceTab)).status, 409, 'A queued write from one account cannot be saved into another account');
    equal((await call('POST', '/api/account/tracks', { state: saved }, alice, { Origin: 'https://elsewhere.example' })).status, 403, 'Cross-origin progress writes are rejected');

    const changed = clone(saved); changed.plan.title = 'Preserved updated curriculum title';
    result = await call('PUT', `/api/account/tracks/${id}`, { state: changed, revision: 1 }, alice);
    equal(result.status, 200, 'The current revision can update its own learning path');
    equal(result.data.track.revision, 2, 'A successful save atomically advances its revision');
    equal((await call('PUT', `/api/account/tracks/${id}`, { state: saved, revision: 1 }, alice)).status, 409, 'A stale tab cannot overwrite newer progress');
    equal((await call('GET', `/api/account/tracks/${id}`, undefined, alice)).data.track.state.plan.title, changed.plan.title, 'A rejected stale save preserves the current account state');
    const retriedImport = (await call('POST', '/api/account/tracks', { state: saved }, alice, { 'Idempotency-Key': 'guest-offline-one' })).data.track;
    equal(retriedImport.id, id, 'An ambiguous import retry finds the original saved record');
    equal(retriedImport.revision, 2, 'An import retry does not overwrite subsequent progress');
    equal(retriedImport.state.plan.title, changed.plan.title, 'The idempotent import preserves the later curriculum title');
    const bobsImport = (await call('POST', '/api/account/tracks', { state: saved }, bob, { 'Idempotency-Key': 'guest-offline-one' })).data.track;
    check(bobsImport.id !== id, 'Import identifiers are scoped independently per account');
    const raced = await Promise.all([call('PUT', `/api/account/tracks/${id}`, { state: changed, revision: 2 }, alice), call('PUT', `/api/account/tracks/${id}`, { state: changed, revision: 2 }, alice)]);
    equal(raced.map(value => value.status).sort(), [200, 409], 'Exactly one simultaneous compare-and-swap update wins');
    equal((await call('PUT', `/api/account/tracks/${id}`, { state: { invalid: true }, revision: 3 }, alice)).status, 400, 'Malformed progress cannot replace saved course state');
    equal((await call('PUT', `/api/account/tracks/${id}`, { state: changed, revision: 1.5 }, alice)).status, 400, 'Revision numbers must be positive safe integers');
    const differentPlan = clone(changed); differentPlan.plan.id = 'a-different-plan';
    equal((await call('PUT', `/api/account/tracks/${id}`, { state: differentPlan, revision: 3 }, alice)).status, 409, 'A path record cannot accidentally be replaced by a different selected plan');
    equal((await call('POST', '/api/account/tracks', { state: saved }, alice, { 'Content-Length': String(MAX_ACCOUNT_STATE_BYTES + 1) })).status, 413, 'Declared oversized progress is rejected before parsing');
    equal((await call('POST', '/api/account/tracks', 'x'.repeat(MAX_ACCOUNT_STATE_BYTES + 1), alice)).status, 413, 'Actual streamed bytes stay bounded even without a size header');

    const largerCourse = clone(saved), lessonId = saved.plan.modules[0].id;
    largerCourse.lessons[lessonId].slides.forEach(slide => { slide.narration = 'Detailed teaching preserves full explanations. '.repeat(500); });
    check(Buffer.byteLength(JSON.stringify(largerCourse)) > 64 * 1024, 'The fixture exceeds the AI request body limit');
    equal((await call('POST', '/api/account/tracks', { state: largerCourse }, alice)).status, 201, 'Account storage accepts full course progress beyond the compact AI request limit');
    const oversizedCourse = clone(saved), base = oversizedCourse.lessons[lessonId].slides[0];
    oversizedCourse.lessons[lessonId].slides = Array.from({ length: 30 }, (_, index) => ({ ...base, id: `large-course-slide-${index}`, narration: 'Teaching a bounded course. '.repeat(1000) }));
    equal((await call('POST', '/api/account/tracks', { state: oversizedCourse }, alice)).status, 413, 'Each stored course retains its separate 512 KiB cap');

    const sqlite = new DatabaseSync(process.env.OWNPATH_DATABASE_PATH);
    const credential = sqlite.prepare('SELECT password_hash,password_salt FROM account_users WHERE id=?').get(alice.user.id);
    check(credential.password_hash !== password && /^scrypt\$32768\$8\$3\$[0-9a-f]{128}$/.test(credential.password_hash), 'New password records include the current scrypt parameters and derived key');
    check(/^[0-9a-f]{32}$/.test(credential.password_salt), 'Each password gets a random sixteen-byte salt');
    const rawToken = alice.cookie.split('=')[1], tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const sessionRow = sqlite.prepare('SELECT token_hash FROM account_sessions WHERE token_hash=?').get(tokenHash);
    check(sessionRow?.token_hash !== rawToken && sessionRow.token_hash === tokenHash, 'Only a hash of the random session secret is stored');
    equal(Buffer.from(rawToken, 'base64url').length, 32, 'Session secrets contain two hundred fifty-six random bits');
    const bobsSalt = sqlite.prepare('SELECT password_salt FROM account_users WHERE id=?').get(bob.user.id).password_salt;
    check(bobsSalt !== credential.password_salt, 'The same password in two accounts receives different random salts');
    const legacySalt = randomBytes(16).toString('hex');
    const legacyHash = scryptSync(password, legacySalt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
    sqlite.prepare('UPDATE account_users SET password_salt=?,password_hash=? WHERE id=?').run(legacySalt, legacyHash, bob.user.id);
    await assert.rejects(store.authenticateAccount({ email: bob.user.email, password: 'A different valid-length phrase!' }), /incorrect/); assertions++;
    equal(sqlite.prepare('SELECT password_hash FROM account_users WHERE id=?').get(bob.user.id).password_hash, legacyHash, 'A wrong password cannot rewrite a legacy account hash');
    equal((await store.authenticateAccount({ email: bob.user.email, password })).id, bob.user.id, 'Existing lower-cost password records still authenticate successfully');
    const upgraded = sqlite.prepare('SELECT password_hash,password_salt FROM account_users WHERE id=?').get(bob.user.id);
    check(/^scrypt\$32768\$8\$3\$[0-9a-f]{128}$/.test(upgraded.password_hash), 'A successful legacy login upgrades to the stronger versioned format');
    check(upgraded.password_salt !== legacySalt, 'A legacy hash upgrade gets a fresh random salt');
    await store.authenticateAccount({ email: bob.user.email, password });
    equal(sqlite.prepare('SELECT password_hash FROM account_users WHERE id=?').get(bob.user.id).password_hash, upgraded.password_hash, 'Current password records verify without unnecessary rehashing');
    equal(fs.statSync(process.env.OWNPATH_DATABASE_PATH).mode & 0o777, 0o600, 'The database file is readable only by its owner');
    sqlite.close();
    store.closeAccountStore();
    equal((await call('GET', `/api/account/tracks/${id}`, undefined, alice)).data.track.state.quizHistory[lessonId], saved.quizHistory[lessonId], 'Reopening the database restores full scores and attempt snapshots');
    equal((await call('GET', '/api/auth/session', undefined, alice)).data.user.id, alice.user.id, 'A valid session survives a database reconnect');

    const loggedIn = await call('POST', '/api/auth/login', { email: 'ALICE@example.test', password }, alice);
    equal(loggedIn.status, 200, 'Normalized email and the correct password sign in');
    const renewed = { user: alice.user, cookie: loggedIn.headers.get('set-cookie').split(';')[0] };
    check(renewed.cookie !== alice.cookie, 'Signing in rotates the random session secret');
    equal((await call('GET', '/api/auth/session', undefined, alice)).data.user, null, 'The replaced session is revoked');
    equal((await call('POST', '/api/auth/logout', undefined, renewed)).data, { user: null }, 'Signing out ends the current session');
    equal((await call('GET', '/api/auth/session', undefined, renewed)).data.user, null, 'A signed-out token cannot restore an account');
    equal((await call('GET', '/api/auth/session', undefined, bob)).data.user.id, bob.user.id, 'Signing out one account does not revoke another account session');
    const expiring = store.createAccountSession(bob.user.id), expiryDb = new DatabaseSync(process.env.OWNPATH_DATABASE_PATH);
    expiryDb.prepare('UPDATE account_sessions SET expires_at=? WHERE token_hash=?').run(Date.now() - 1, createHash('sha256').update(expiring).digest('hex')); expiryDb.close();
    equal(store.findAccountSession(expiring), null, 'Expired sessions cannot authenticate');
    for (let index = 0; index < 8; index++) equal((await call('POST', '/api/auth/login', { email: 'limited@example.test', password })).status, 401, 'Failed login attempts keep a safe response');
    const throttled = await call('POST', '/api/auth/login', { email: 'limited@example.test', password });
    equal(throttled.status, 429, 'Repeated failed sign-ins are throttled');
    check(Number(throttled.headers.get('retry-after')) > 0, 'Throttle responses include a bounded retry time');
    store.closeAccountStore();
    equal((await call('POST', '/api/auth/login', { email: 'limited@example.test', password })).status, 429, 'The login throttle survives a database reconnect');

    while (store.listAccountTracks(bob.user.id).length < 99) store.createAccountTrack(bob.user.id, saved);
    const capacityRace = await Promise.allSettled([
      Promise.resolve().then(() => store.createAccountTrack(bob.user.id, saved, 'capacity-last-a')),
      Promise.resolve().then(() => store.createAccountTrack(bob.user.id, saved, 'capacity-last-b')),
    ]);
    equal(capacityRace.filter(result => result.status === 'fulfilled').length, 1, 'Only one concurrent create can claim the final account slot');
    const overCapacity = capacityRace.find(result => result.status === 'rejected');
    equal(overCapacity.reason.code, 'TRACK_LIMIT', 'A competing over-capacity create receives the explicit track quota error');
    equal(store.listAccountTracks(bob.user.id).length, 100, 'The atomic per-account path count cannot exceed one hundred');
    equal(store.createAccountTrack(bob.user.id, saved, 'guest-offline-one').id, bobsImport.id, 'An idempotent retry still returns its saved path when the account is full');
    equal((await call('POST', '/api/account/tracks', { state: saved }, bob)).status, 409, 'The HTTP create endpoint enforces account capacity');
    equal(store.listAccountTracks(alice.user.id).length, 4, 'Another account capacity does not consume this account slots');
    equal((await call('DELETE', `/api/account/tracks/${bobsImport.id}`, { revision: 1 }, bob)).status, 200, 'An owner can delete its own saved path at the current revision');
    equal((await call('GET', `/api/account/tracks/${bobsImport.id}`, undefined, bob)).status, 404, 'Deleting a path does not leave it readable');
    store.createAccountTrack(bob.user.id, saved);
    equal(store.listAccountTracks(bob.user.id).length, 100, 'Deleting an unused path makes its quota slot available again');
    check(second.id && third.id, 'Independent same-direction and different-direction paths remain stored');

    const nativeScrypt = cryptoModule.scrypt, pending = [];
    let active = 0, peakActive = 0;
    try {
      cryptoModule.scrypt = (_password, _salt, _length, options, callback) => {
        equal(options.p, 3, 'Queued new password work always uses the stronger parallelization cost');
        active++; peakActive = Math.max(peakActive, active);
        pending.push(() => { active--; callback(null, Buffer.alloc(64, 1)); });
      };
      const work = Promise.allSettled(Array.from({ length: 11 }, (_, index) => store.registerAccount({ name: 'Synthetic capacity test', email: `kdf-${index}@example.test`, password })));
      for (let turn = 0; turn < 40; turn++) {
        for (let step = 0; step < 8; step++) await Promise.resolve();
        const batch = pending.splice(0);
        batch.forEach(finish => finish());
      }
      const settled = await work;
      equal(settled.filter(result => result.status === 'fulfilled').length, 10, 'At most two active and eight queued password jobs are accepted');
      equal(settled.filter(result => result.status === 'rejected').length, 1, 'Overflow password derivations are rejected instead of growing an unbounded queue');
      equal(settled.find(result => result.status === 'rejected').reason.status, 429, 'A full password-work queue returns retryable HTTP 429');
      equal(peakActive, 2, 'Native password derivations never exceed the two-job active limit');
      equal(active, 0, 'All accepted derivations release their capacity slots');
    } finally { cryptoModule.scrypt = nativeScrypt; }
    console.log(`PASS ${assertions} account assertions: actual SQLite persistence, secure credentials/sessions, per-account paths, import idempotency, CAS conflicts, full course/history storage, bounded bodies, and auth throttling.`);
    console.log('The suite uses a disposable database and synthetic credentials; it makes no external API calls.');
  } finally {
    store.closeAccountStore();
    if (originalPath === undefined) delete process.env.OWNPATH_DATABASE_PATH; else process.env.OWNPATH_DATABASE_PATH = originalPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
