/* eslint-disable @typescript-eslint/no-require-imports */
/** Azure synthesis contract checks use fake credentials and stubbed provider transport. */
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
const route = load('app/api/narration/route.ts');
const library = load('lib/azure-narration.ts');
const audio = () => new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
const url = 'http://localhost/api/narration';
const request = (value, options = {}) => new Request(url, {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...options.headers },
  body: typeof value === 'string' ? value : JSON.stringify(value), signal: options.signal,
});
async function post(value, options) { return route.POST(request(value, options)); }
async function failure(response, status, label) {
  equal(response.status, status, `${label}: status`);
  equal(response.headers.get('cache-control'), 'no-store', `${label}: no cache`);
  const data = await response.json();
  check(typeof data.error?.message === 'string', `${label}: safe user message`);
  check(!JSON.stringify(data).includes('private-provider-detail') && !JSON.stringify(data).includes('fake-speech-resource-key'), `${label}: no secrets or provider details`);
}
const originalFetch = global.fetch;
const oldKey = process.env.AZURE_SPEECH_KEY, oldRegion = process.env.AZURE_SPEECH_REGION;
(async () => {
  try {
    delete process.env.AZURE_SPEECH_KEY; delete process.env.AZURE_SPEECH_REGION;
    global.fetch = async () => { throw new Error('Unexpected transport'); };
    let status = await route.GET();
    equal(status.status, 200, 'Status can be read without a resource');
    const missingStatus = await status.json();
    equal({ available: missingStatus.available, voice: missingStatus.voice, voiceId: missingStatus.voiceId, reason: missingStatus.reason }, { available: false, voice: 'Amanda Multilingual', voiceId: 'en-US-AmandaMultilingualNeural', reason: 'not-configured' }, 'Status identifies missing configuration without exposing secrets');
    check(missingStatus.message.includes('Azure Speech key and matching region'), 'Missing setup includes actionable guidance');
    equal(status.headers.get('cache-control'), 'no-store', 'Status is not cached');
    await failure(await post({ text: 'Read this slide.' }), 503, 'Missing credentials');
    await failure(await post({ text: 'Loopback slide.' }, { headers: { Host: '127.0.0.1:3002', Origin: 'http://127.0.0.1:3002' } }), 503, 'Normalized NextURL accepts the actual loopback origin');
    await failure(await post({ text: 'Host check.' }, { headers: { Host: 'localhost', Origin: 'https://forged.example', 'X-Forwarded-Host': 'forged.example' } }), 403, 'Forwarded host cannot authorize a different origin');
    await failure(await post({ text: 'Host check.' }, { headers: { Host: 'localhost/path' } }), 403, 'Malformed host is rejected');

    process.env.AZURE_SPEECH_KEY = 'YOUR_API_KEY_HERE'; process.env.AZURE_SPEECH_REGION = 'eastus';
    equal((await library.getNarrationStatus()).available, false, 'A placeholder key does not advertise availability');
    process.env.AZURE_SPEECH_KEY = 'fake-speech-resource-key';
    process.env.AZURE_SPEECH_REGION = 'eastus.invalid/path';
    equal((await library.getNarrationStatus()).available, false, 'An invalid region cannot build a provider hostname');
    process.env.AZURE_SPEECH_REGION = 'eastus';
    let statusCalls = 0;
    global.fetch = async (endpoint, init) => {
      statusCalls++;
      equal(endpoint, 'https://eastus.tts.speech.microsoft.com/cognitiveservices/voices/list', 'Status verifies the regional Azure voice catalog');
      equal(init.headers['Ocp-Apim-Subscription-Key'], 'fake-speech-resource-key', 'Connection verification keeps credentials server-side');
      return Response.json([{ ShortName: 'en-US-AmandaMultilingualNeural' }]);
    };
    const verified = await Promise.all([route.GET(), route.GET()]);
    equal((await verified[0].json()).available, true, 'Only a verified resource with Amanda advertises availability');
    equal((await verified[1].json()).available, true, 'Concurrent status checks share the verification');
    await route.GET();
    equal(statusCalls, 1, 'Repeated checks use a short-lived verification cache');
    process.env.AZURE_SPEECH_KEY = 'rejected-speech-key';
    global.fetch = async () => new Response('private-provider-detail', { status: 401 });
    let disconnected = await (await route.GET()).json();
    equal(disconnected.reason, 'authentication', 'Rejected credentials do not show a connected voice');
    check(!JSON.stringify(disconnected).includes('private-provider-detail') && !JSON.stringify(disconnected).includes('rejected-speech-key'), 'Verification errors withhold credentials and provider details');
    process.env.AZURE_SPEECH_KEY = 'unsupported-region-key';
    global.fetch = async () => Response.json([{ ShortName: 'en-US-JennyNeural' }]);
    disconnected = await (await route.GET()).json();
    equal(disconnected.reason, 'voice-unavailable', 'A region without Amanda is distinguished from missing setup');
    process.env.AZURE_SPEECH_KEY = 'network-failure-key';
    global.fetch = async () => { throw new Error('private-provider-detail'); };
    equal((await (await route.GET()).json()).reason, 'service-unavailable', 'Network failures do not advertise availability');
    process.env.AZURE_SPEECH_KEY = 'oversized-catalog-key';
    global.fetch = async () => new Response('x', { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } });
    equal((await (await route.GET()).json()).reason, 'service-unavailable', 'Oversized voice catalogs are rejected');
    process.env.AZURE_SPEECH_KEY = 'fake-speech-resource-key';

    for (const body of [{}, null, [], { text: '' }, { text: '  ' }, { text: '\u0000\u0001' }, { text: 4 }, { text: 'x'.repeat(5001) }, { text: 'x', voice: 'other' }]) {
      await failure(await post(body), 400, 'Invalid narration');
    }
    await failure(await post('{invalid'), 400, 'Malformed JSON');
    await failure(await post({ text: 'x' }, { headers: { Origin: 'https://another.example' } }), 403, 'Cross-origin request');
    await failure(await post({ text: 'x' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'Cross-site request');
    await failure(await post({ text: 'x' }, { headers: { 'Content-Type': 'text/plain' } }), 415, 'Wrong content type');
    await failure(await post({ text: 'x' }, { headers: { 'Content-Length': '65537' } }), 413, 'Declared oversized request');

    const calls = [];
    global.fetch = async (endpoint, init) => { calls.push({ endpoint, init }); return audio(); };
    const text = 'Use <value> & "quotes" and \'apostrophes\'.\u0000\u0001\nNext line.\ud800';
    let response = await post({ text });
    equal(response.status, 200, 'Synthesis succeeds');
    equal(response.headers.get('content-type'), 'audio/mpeg', 'The response is playable MP3 audio');
    equal(response.headers.get('cache-control'), 'no-store', 'Audio is not stored by browser/proxy caches');
    equal([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 1, 2, 3], 'The provider audio reaches the player intact');
    equal(calls[0].endpoint, 'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1', 'The region selects the official fixed Azure endpoint');
    equal(calls[0].init.headers['Ocp-Apim-Subscription-Key'], 'fake-speech-resource-key', 'Credentials remain in a server-to-provider header');
    equal(calls[0].init.headers['X-Microsoft-OutputFormat'], 'audio-24khz-96kbitrate-mono-mp3', 'Synthesis requests the supported MP3 format');
    check(calls[0].init.body.includes('name="en-US-AmandaMultilingualNeural"'), 'The requested narrator is Amanda Multilingual');
    check(calls[0].init.body.includes('&lt;value&gt; &amp; &quot;quotes&quot; and &apos;apostrophes&apos;.'), 'Narration cannot inject SSML');
    check(!calls[0].init.body.includes('\u0000') && !calls[0].init.body.includes('\u0001') && calls[0].init.body.includes('\nNext line.\ufffd'), 'XML-invalid controls and unpaired surrogates are normalized');
    response = await post({ text }); await response.arrayBuffer();
    equal(calls.length, 1, 'Replaying the same slide reuses a short-lived server audio cache');
    process.env.AZURE_SPEECH_KEY = 'another-fake-key';
    response = await post({ text }); await response.arrayBuffer();
    equal(calls.length, 2, 'Changing the configured resource invalidates cached speech');

    global.fetch = async () => new Response('private-provider-detail', { status: 401 });
    await failure(await post({ text: 'Unauthorized slide' }), 502, 'Provider authorization failure');
    global.fetch = async () => new Response('private-provider-detail', { status: 429 });
    await failure(await post({ text: 'Busy slide' }), 429, 'Provider rate limit');
    global.fetch = async () => { throw new Error('private-provider-detail'); };
    await failure(await post({ text: 'Network failure slide' }), 502, 'Network failure');
    global.fetch = async () => new Response('private-provider-detail', { headers: { 'Content-Type': 'application/json' } });
    await failure(await post({ text: 'Unexpected response slide' }), 502, 'Wrong provider output');
    global.fetch = async () => new Response(new Uint8Array(), { headers: { 'Content-Type': 'audio/mpeg' } });
    await failure(await post({ text: 'Empty response slide' }), 502, 'Empty provider audio');
    global.fetch = async () => new Response('x', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(8 * 1024 * 1024 + 1) } });
    await failure(await post({ text: 'Oversized response slide' }), 502, 'Oversized provider audio');

    const canceled = new AbortController(); canceled.abort();
    await failure(await post({ text: 'Canceled slide' }, { signal: canceled.signal }), 499, 'Canceled before synthesis');
    const inFlight = new AbortController(); let providerSignal;
    global.fetch = (endpoint, init) => {
      providerSignal = init.signal;
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    };
    const pending = post({ text: 'Cancel this pending slide' }, { signal: inFlight.signal });
    await new Promise(setImmediate); inFlight.abort();
    await failure(await pending, 499, 'Canceled during synthesis');
    check(providerSignal.aborted, 'Canceling playback also cancels provider transport');
    console.log(`PASS ${assertions} narration API assertions: availability, credentials, SSML, validation, cache, safe failures, and cancellation.`);
    console.log('Azure transport was stubbed; no speech charges or live API calls were made.');
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.AZURE_SPEECH_KEY; else process.env.AZURE_SPEECH_KEY = oldKey;
    if (oldRegion === undefined) delete process.env.AZURE_SPEECH_REGION; else process.env.AZURE_SPEECH_REGION = oldRegion;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
