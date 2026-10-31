/* eslint-disable @typescript-eslint/no-require-imports */
/** Resume integration regressions. Parser is real; provider transport is stubbed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
let assertions = 0;
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };

function load(relative, overrides = {}, cache = modules) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const item = { exports: {} }; cache.set(filename, item);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const nativeRequire = NativeModule.createRequire(filename);
  const requireLocal = name => {
    if (name in overrides) return overrides[name];
    if (name === 'server-only') return {};
    if (name.startsWith('@/')) {
      const target = ['.ts', '.tsx'].map(extension => name.slice(2) + extension).find(file => fs.existsSync(path.join(root, file)));
      return load(target, overrides, cache);
    }
    return nativeRequire(name);
  };
  requireLocal.resolve = nativeRequire.resolve;
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(item.exports, requireLocal, item, filename, path.dirname(filename));
  return item.exports;
}

const resumeText = [
  'Jordan Example',
  'Education',
  'Bachelor of Science in Statistics, Example University, 2022',
  'Experience',
  'Data Analyst, Example Company, 2022-2025',
  'Built Python and SQL reports. Led project management and stakeholder communication.',
  'Skills',
  'Python, SQL, Excel, project management, stakeholder communication',
].join('\n');

/** Self-contained valid PDFs avoid fixture binaries and optional PDF-writing packages. */
function pdf({ text = resumeText, scanned = false, pages = 1 } = {}) {
  const escapePdf = value => value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const drawing = scanned ? 'q 200 0 0 200 50 500 cm /Im1 Do Q' :
    ['BT /F1 11 Tf 50 750 Td', ...text.split('\n').map((line, index) => `${index ? '0 -18 Td ' : ''}(${escapePdf(line)}) Tj`), 'ET'].join('\n');
  const content = Buffer.from(drawing, 'ascii');
  const pageIds = Array.from({ length: pages }, (_, index) => 6 + index);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.byteLength} >>\nstream\n${drawing}\nendstream`,
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n00>\nendstream',
    ...pageIds.map(() => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'),
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
}

async function request(body, headers = {}) {
  const response = await load('app/api/resume/route.ts').POST(new Request('http://localhost/api/resume', {
    method: 'POST', headers: { Origin: 'http://localhost', ...headers }, body,
  }));
  equal(response.headers.get('cache-control'), 'no-store', 'Resume responses cannot be cached');
  return { status: response.status, data: await response.json() };
}
const json = (body, headers = {}) => request(JSON.stringify(body), { 'Content-Type': 'application/json', ...headers });
function upload(content, name = 'resume.txt', type = 'text/plain', useClaude = false) {
  const form = new FormData();
  form.append('file', new File([content], name, { type }));
  form.append('useClaude', String(useClaude));
  return request(form);
}
function validResult(result, label) {
  equal(result.status, 200, `${label} succeeds`);
  check(['claude', 'fallback'].includes(result.data.mode), `${label} reports extraction mode`);
  const { profile, text, warnings } = result.data;
  check(typeof text === 'string' && text.length <= 16000, `${label} bounds source text`);
  check(typeof profile.background === 'string' && profile.background.length <= 2000, `${label} bounds education`);
  check(typeof profile.experience === 'string' && profile.experience.length <= 2000, `${label} bounds experience`);
  check(Array.isArray(profile.skills) && profile.skills.length <= 30 && profile.skills.every(skill => typeof skill === 'string' && skill.length <= 80) && profile.skills.join(', ').length <= 1000, `${label} bounds skills within the curriculum contract`);
  check(Array.isArray(warnings) && warnings.length <= 10 && warnings.every(warning => typeof warning === 'string' && warning.length <= 500), `${label} has bounded review guidance`);
}
function rejected(result, label) {
  check(result.status >= 400 && result.status < 500, `${label} is rejected with a client error`);
  check(typeof result.data.error?.message === 'string' && result.data.error.message.length < 500, `${label} has a bounded user-facing error`);
  check(!JSON.stringify(result.data).includes(resumeText), `${label} does not echo resume text`);
}

async function textAndPdf() {
  delete process.env.ANTHROPIC_API_KEY;
  let networkCalls = 0;
  global.fetch = async () => { networkCalls++; throw new Error('No provider should be contacted'); };
  const txt = await upload(resumeText);
  validResult(txt, 'UTF-8 TXT resume');
  equal(txt.data.mode, 'fallback', 'Missing API key uses deterministic extraction');
  check(txt.data.profile.background.includes('Bachelor of Science in Statistics'), 'Education populates from explicit education text');
  check(txt.data.profile.experience.includes('Data Analyst'), 'Experience populates from the resume');
  check(txt.data.profile.skills.some(skill => /python/i.test(skill)), 'Technical skills populate');
  check(txt.data.profile.skills.some(skill => /communication|project management/i.test(skill)), 'Other explicit competencies populate');
  check(txt.data.text.includes('Example University'), 'Source remains available for manual review');
  const txtAgain = await upload(resumeText);
  equal(txtAgain.data.profile, txt.data.profile, 'Fallback extraction is deterministic');
  const pasted = await json({ text: resumeText, useClaude: true });
  validResult(pasted, 'Pasted resume without configured Claude');
  equal(pasted.data.mode, 'fallback', 'Opt-in with no key remains a useful fallback');
  const selectable = await upload(pdf(), 'resume.pdf', 'application/pdf');
  validResult(selectable, 'Selectable-text PDF');
  check(selectable.data.profile.background.includes('Statistics'), 'PDF education reaches profile fields');
  check(selectable.data.profile.experience.includes('Data Analyst'), 'PDF experience reaches profile fields');
  check(selectable.data.profile.skills.some(skill => /python/i.test(skill)), 'PDF skills reach profile fields');
  const machineLearning = await json({ text: 'Education\nStatistics degree\nSkills\nMachine learning, Deep learning', useClaude: false });
  validResult(machineLearning, 'Explicit machine learning skills');
  equal(machineLearning.data.profile.skills, ['Machine learning', 'Deep learning'], 'Fallback retains demonstrated skills containing the word learning');
  equal(networkCalls, 0, 'Missing key never calls a provider');
  return txt.data;
}

async function rejectedInputs() {
  rejected(await upload('not a PDF', 'resume.pdf', 'application/pdf'), 'Malformed PDF');
  rejected(await upload(pdf({ scanned: true }), 'scanned.pdf', 'application/pdf'), 'Image-only scanned PDF');
  rejected(await upload('', 'resume.txt'), 'Empty TXT');
  rejected(await upload(Buffer.from([0, 255, 0, 255]), 'resume.txt'), 'Binary TXT');
  rejected(await upload(resumeText, 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'Unsupported document');
  rejected(await upload(Buffer.alloc(2 * 1024 * 1024 + 1, 65)), 'Oversized file');
  rejected(await upload(pdf(), 'resume.txt', 'text/plain'), 'PDF disguised as TXT');
  rejected(await upload(pdf({ pages: 21 }), 'many-pages.pdf', 'application/pdf'), 'PDF exceeding parser page budget');
  rejected(await json({ text: '' }), 'Empty pasted text');
  rejected(await json({ text: 42 }), 'Non-string pasted text');
  rejected(await request('{broken', { 'Content-Type': 'application/json' }), 'Malformed JSON');
  rejected(await request('x', { 'Content-Type': 'text/plain' }), 'Unsupported request encoding');
  rejected(await json({ text: resumeText }, { Origin: 'https://untrusted.example' }), 'Cross-origin request');
  const reconstructed = await json({ text: resumeText, useClaude: false }, { Host: '127.0.0.1:3003', Origin: 'http://127.0.0.1:3003' });
  validResult(reconstructed, 'Same-origin request with Next reconstructed hostname');
  rejected(await json({ text: resumeText }, { Host: '127.0.0.1:3003', Origin: 'http://untrusted.example' }), 'Host-bound cross-origin request');
  rejected(await json({ text: resumeText }, { Host: '127.0.0.1:3003', Origin: 'https://untrusted.example', 'X-Forwarded-Host': 'untrusted.example' }), 'Forged forwarded-host origin');
  rejected(await request(new FormData()), 'Missing upload');
  const multiple = new FormData();
  multiple.append('file', new File([resumeText], 'one.txt', { type: 'text/plain' }));
  multiple.append('file', new File([resumeText], 'two.txt', { type: 'text/plain' }));
  rejected(await request(multiple), 'Multiple uploads');
}

async function providerExtraction() {
  const draft = {
    education: ['Bachelor of Science in Statistics, Example University, 2022'],
    experience: ['Data Analyst, Example Company, 2022-2025', 'Built Python and SQL reports. Led project management and stakeholder communication.'],
    skills: ['Python', 'SQL', 'project management', 'stakeholder communication'],
  };
  const key = 'sk-ant-FAKE-RESUME-TEST-ONLY';
  process.env.ANTHROPIC_API_KEY = key;
  let calls = [];
  let responseDraft = draft;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(responseDraft) }] });
  };
  const local = await json({ text: resumeText, useClaude: false });
  validResult(local, 'Configured provider without consent');
  equal(local.data.mode, 'fallback', 'Claude is opt-in');
  equal(calls.length, 0, 'Unchecked Claude permission never transmits resume text');
  const extracted = await json({ text: resumeText, useClaude: true });
  validResult(extracted, 'Structured Claude extraction');
  equal(extracted.data.mode, 'claude', 'Successful grounded provider output reports Claude');
  equal(calls.length, 1, 'Consented extraction makes one provider call');
  equal(calls[0].url, 'https://api.anthropic.com/v1/messages', 'Resume is only sent to the fixed Claude endpoint');
  const sent = JSON.parse(calls[0].init.body);
  check(JSON.stringify(sent.messages).includes('Example University'), 'Claude receives resume evidence server-side');
  check(JSON.stringify(sent.system).includes('untrusted'), 'Claude instructions treat resume text as untrusted');
  check(!JSON.stringify(extracted.data).includes(key), 'Credentials never appear in result');
  check(extracted.data.profile.skills.includes('SQL'), 'Structured supported skills populate profile');

  responseDraft = { ...draft, education: ['Doctor of Medicine, Invented University'], skills: ['Kubernetes'] };
  const fabricated = await json({ text: resumeText, useClaude: true });
  validResult(fabricated, 'Unsupported provider qualifications');
  check(!JSON.stringify(fabricated.data.profile).includes('Invented University') && !fabricated.data.profile.skills.includes('Kubernetes'), 'Unsupported qualifications never populate profile');

  const noSkillsText = 'Education\nHigh school diploma\nExperience\nNo Python experience. Interested in learning React.';
  responseDraft = { education: ['High school diploma'], experience: [], skills: ['Python', 'React'] };
  const negative = await json({ text: noSkillsText, useClaude: true });
  validResult(negative, 'Negated skills and future interests');
  check(!negative.data.profile.skills.some(skill => /python|react/i.test(skill)), 'Negated abilities and aspirations do not become demonstrated skills');
  const negativeLocal = await json({ text: noSkillsText, useClaude: false });
  validResult(negativeLocal, 'Fallback with negated skills');
  check(!negativeLocal.data.profile.skills.some(skill => /python|react/i.test(skill)), 'Fallback never assumes skills from negation or aspirations');

  const negatedListText = 'Education\nHigh school diploma\nSkills\nNo Python, React\nExperience\nCurrently learning advanced SQL.';
  responseDraft = { education: ['High school diploma'], experience: ['Currently learning advanced SQL.'], skills: ['Python', 'React', 'SQL'] };
  const negatedList = await json({ text: negatedListText, useClaude: true });
  validResult(negatedList, 'Provider output from a negated skill list');
  equal(negatedList.data.profile.skills, [], 'Claude skills preserve list-level negation and advanced learning qualifiers');
  const negatedListLocal = await json({ text: negatedListText, useClaude: false });
  validResult(negatedListLocal, 'Fallback with negated comma-separated skills');
  equal(negatedListLocal.data.profile.skills, [], 'Splitting a skills list cannot erase a negation');

  for (const statement of [
    'Never used Python, SQL',
    'Unfamiliar with Python, SQL',
    'Inexperienced with Python, SQL',
    "Haven't learned Python, SQL",
    'Can’t use Python, SQL',
    'Yet to learn Python, SQL',
  ]) {
    const source = `Education\nHigh school diploma\nSkills\n${statement}\nExcel`;
    const local = await json({ text: source, useClaude: false });
    validResult(local, `Fallback with ${statement}`);
    equal(local.data.profile.skills, ['Excel'], `${statement}: fallback preserves negation across a split skills list and retains supported skills`);
    responseDraft = { education: ['High school diploma'], experience: [], skills: ['Python', 'SQL', 'Excel'] };
    const provider = await json({ text: source, useClaude: true });
    validResult(provider, `Claude output with ${statement}`);
    equal(provider.data.mode, 'fallback', `${statement}: exact excerpts still require positive skill evidence`);
    equal(provider.data.profile.skills, ['Excel'], `${statement}: unsafe provider extraction falls back to supported skills`);
  }

  const machineLearningText = 'Education\nStatistics degree\nSkills\nMachine learning, Deep learning';
  responseDraft = { education: ['Statistics degree'], experience: [], skills: ['Machine learning', 'Deep learning'] };
  const machineLearning = await json({ text: machineLearningText, useClaude: true });
  validResult(machineLearning, 'Claude extraction with explicit learning skills');
  equal(machineLearning.data.mode, 'claude', 'Supported machine learning skills remain in provider mode');
  equal(machineLearning.data.profile.skills, ['Machine learning', 'Deep learning'], 'Claude validation retains explicit Machine learning and Deep learning skills');

  const qualifiedText = 'Education\nDid not complete Bachelor of Science\nExperience\nAssisted with reports; no management responsibilities';
  responseDraft = { education: ['Bachelor of Science'], experience: ['management responsibilities'], skills: [] };
  const qualified = await json({ text: qualifiedText, useClaude: true });
  validResult(qualified, 'Provider output omitting qualification context');
  check(!qualified.data.profile.background.includes('Bachelor of Science') || /not complete/i.test(qualified.data.profile.background), 'Incomplete qualifications never become completed degrees');
  check(!qualified.data.profile.experience.includes('management responsibilities') || /no management/i.test(qualified.data.profile.experience), 'Provider substrings cannot erase experience qualifiers');

  for (const [label, stub] of [
    ['Provider unavailable', async () => { throw new Error(`${key} PRIVATE_PROVIDER_BODY`); }],
    ['Malformed provider JSON', async () => new Response('{bad')],
    ['Oversized provider response', async () => new Response('x'.repeat(256 * 1024))],
    ['Provider refusal', async () => Response.json({ stop_reason: 'refusal', content: [] })],
  ]) {
    global.fetch = stub;
    const result = await json({ text: resumeText, useClaude: true });
    validResult(result, label);
    equal(result.data.mode, 'fallback', `${label} remains manually useful`);
    check(!JSON.stringify(result.data).includes(key) && !JSON.stringify(result.data).includes('PRIVATE_PROVIDER_BODY'), `${label} does not expose provider internals`);
  }
  delete process.env.ANTHROPIC_API_KEY;
}

async function curriculumCompatibility() {
  const verboseText = [
    'Education',
    ...Array.from({ length: 35 }, (_, index) => `Graduate certificate ${index + 1} in statistical data analysis, Example University, 2022`),
    'Experience',
    ...Array.from({ length: 35 }, (_, index) => `Project ${index + 1}: built Python reporting pipelines and prepared SQL data for stakeholder analysis.`),
    'Skills', 'Python, SQL, Excel',
  ].join('\n');
  const extracted = await json({ text: verboseText, useClaude: false });
  validResult(extracted, 'Verbose resume');
  const profile = {
    id: 'resume-curriculum-test', name: 'Jordan', ...extracted.data.profile,
    goals: 'Use data to analyze customer retention', availableStudyTime: 5, track: 'data-science',
  };
  const response = await load('app/api/plan/route.ts').POST(new Request('http://localhost/api/plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }),
  }));
  equal(response.status, 200, 'Bounded verbose resume fields remain compatible with existing curriculum API');
  const generated = await response.json();
  equal(generated.mode, 'mock', 'Resume curriculum works without a real API key');
  const { assertStudyPlan } = load('lib/validators.ts');
  assertStudyPlan(generated.plan); assertions++;
  const beginner = load('lib/mock-data.ts').createMockPlan({ ...profile, background: 'High school', experience: '', skills: [] });
  check(generated.plan.modules.some((module, index) => module.estimatedDuration < beginner.modules[index].estimatedDuration), 'Resume evidence changes existing mock curriculum pacing');
}

function uiHooks() {
  const slots = []; let index = 0;
  return {
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
      },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useEffect() {},
    },
    render(component) { index = 0; return component(); },
  };
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const input = (tree, id) => find(tree, node => node.props?.id === id);
function nodeText(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(nodeText).join('');
  return tree && typeof tree === 'object' ? nodeText(tree.props?.children) : '';
}

async function uploadJourneys(result) {
  const hooks = uiHooks();
  const extracted = [], busy = [], requests = [];
  const { ResumeUpload } = load('components/resume-upload.tsx', {
    react: hooks.react, 'react/jsx-runtime': jsx, './resume-upload.module.css': {},
  }, new Map());
  const props = { disabled: false, onExtracted: value => extracted.push(value), onBusyChange: value => busy.push(value) };
  let tree;
  const render = () => { tree = hooks.render(() => ResumeUpload(props)); };
  const button = label => find(tree, node => node.type === 'button' && nodeText(node.props.children) === label);
  const settle = () => new Promise(setImmediate);
  render();
  equal(find(tree, node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false, 'Resume Claude opt-in starts unchecked');
  global.fetch = async (url, init) => { requests.push({ url, init }); return Response.json(result); };
  input(tree, 'resume-text').props.onChange({ target: { value: resumeText } }); render();
  button('Read pasted text').props.onClick(); await settle(); render();
  equal(requests[0].url, '/api/resume', 'Resume source never appears in a public URL');
  equal(requests[0].init.method, 'POST', 'Resume extraction uses a request body');
  equal(JSON.parse(requests[0].init.body).useClaude, false, 'Default browser request withholds Claude permission');
  equal(extracted, [result], 'Successful browser extraction supplies validated editable result');
  equal(busy, [true, false], 'Upload reports processing state to form');
  equal(input(tree, 'resume-text').props.value, '', 'Successful extraction releases pasted input');

  let finish;
  global.fetch = (url, init) => { requests.push({ url, init }); return new Promise(resolve => { finish = resolve; }); };
  input(tree, 'resume-text').props.onChange({ target: { value: resumeText } }); render();
  button('Read pasted text').props.onClick(); render();
  button('Cancel extraction').props.onClick(); render();
  finish(Response.json(result)); await settle(); render();
  equal(extracted.length, 1, 'Cancelled response cannot overwrite the learner profile');
  equal(busy.at(-1), false, 'Cancel restores manual form submission');

  global.fetch = async () => Response.json({ profile: { background: 'Unbounded profile shape' } });
  button('Read pasted text').props.onClick(); await settle(); render();
  equal(extracted.length, 1, 'Invalid provider response never reaches editable profile');
  check(nodes(tree).some(node => node.props?.role === 'alert'), 'Unreadable extraction displays an accessible error');

  const countBefore = requests.length;
  input(tree, 'resume-file').props.onChange({ target: { files: [new File(['x'], 'resume.docx')] } }); render();
  button('Read resume').props.onClick(); await settle(); render();
  equal(requests.length, countBefore, 'Unsupported files are rejected before browser transmission');
}

async function formJourneys(result) {
  const resumeComponents = { ResumeUpload: 'ResumeUpload', ResumeReview: 'ResumeReview', ResumeSuggestion: 'ResumeSuggestion' };
  function harness(savedProfile = null) {
    const hooks = uiHooks();
    const sent = [], saved = [], navigated = [];
    const overrides = {
      react: hooks.react,
      'react/jsx-runtime': jsx,
      'next/navigation': { useRouter: () => ({ push: url => navigated.push(url) }) },
      '@/components/icon': { Icon: () => null },
      '@/components/resume-upload': resumeComponents,
      '@/lib/learning-context': { useLearning: () => ({ ready: true, state: { profile: savedProfile, plan: null }, setPlan: (...values) => saved.push(values) }) },
      '@/lib/api-client': { requestPlanResponse: async profile => { sent.push(profile); return { plan: load('lib/mock-data.ts').createMockPlan(profile), mode: 'mock' }; } },
    };
    const { ProfileForm } = load('components/profile-form.tsx', overrides, new Map());
    const Fields = ProfileForm().type;
    let tree;
    const render = () => { tree = hooks.render(Fields); return tree; };
    const edit = (id, value) => { input(tree, id).props.onChange({ target: { value } }); render(); };
    const extract = value => { find(tree, node => node.type === 'ResumeUpload').props.onExtracted(value); render(); };
    const review = value => { find(tree, node => node.type === 'ResumeReview').props.onChange(value); render(); };
    const submit = async (fields = { name: 'Jordan', goals: 'Analyze customer data' }) => {
      const NativeFormData = global.FormData;
      global.FormData = class { constructor(values) { this.values = values; } get(name) { return this.values[name]; } };
      try { await find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: fields }); }
      finally { global.FormData = NativeFormData; }
      render();
    };
    render();
    return { render, edit, extract, review, submit, sent, saved, navigated, get tree() { return tree; } };
  }
  const manual = harness();
  manual.edit('background', 'Economics degree');
  manual.edit('experience', 'Customer support');
  manual.edit('skills', 'Excel, communication');
  await manual.submit();
  equal(manual.sent.length, 1, 'Manual onboarding generates a plan without uploading or reviewing a resume');
  equal(manual.sent[0].background, 'Economics degree', 'Manual background reaches existing plan API');
  equal(manual.navigated, ['/dashboard'], 'Manual onboarding retains dashboard navigation');

  const empty = harness();
  empty.extract(result);
  equal(input(empty.tree, 'background').props.value, result.profile.background, 'Resume automatically fills empty education');
  equal(input(empty.tree, 'experience').props.value, result.profile.experience, 'Resume automatically fills empty experience');
  equal(input(empty.tree, 'skills').props.value, result.profile.skills.join(', '), 'Resume automatically fills empty skills');
  await empty.submit();
  equal(empty.sent.length, 0, 'Unreviewed resume cannot generate a plan');
  empty.review(true);
  empty.edit('experience', 'Edited project experience');
  equal(find(empty.tree, node => node.type === 'ResumeReview').props.reviewed, false, 'Editing extracted fields requires a fresh review');
  empty.review(true);
  await empty.submit();
  equal(empty.sent.length, 1, 'Reviewed edited resume creates a curriculum');
  equal(empty.sent[0].experience, 'Edited project experience', 'Edited extracted text reaches curriculum API');
  equal(empty.sent[0].skills, result.profile.skills, 'Resume skills use the existing LearnerProfile contract');
  equal(empty.saved[0][0], empty.sent[0], 'Saved learner profile is the reviewed outgoing profile');
  check(empty.saved[0][1].summary.includes(result.profile.background.replace(/[.!?]+$/, '')), 'Resume background affects generated curriculum summary');
  const { assertProfile } = load('lib/validators.ts');
  assertProfile(empty.sent[0]); assertions++;

  const previous = {
    id: 'existing-learner', name: 'Jordan', background: 'Manually entered education',
    experience: 'Manually entered experience', skills: ['Manual skill'], goals: 'Build websites',
    availableStudyTime: 9, track: 'web-development',
  };
  const preserved = harness(previous);
  const oldCallback = find(preserved.tree, node => node.type === 'ResumeUpload').props.onExtracted;
  preserved.edit('background', 'Newest manual edit made during extraction');
  oldCallback(result); preserved.render();
  equal(input(preserved.tree, 'background').props.value, 'Newest manual edit made during extraction', 'Extraction preserves edits made while upload is pending');
  equal(input(preserved.tree, 'experience').props.value, previous.experience, 'Extraction preserves existing experience');
  equal(input(preserved.tree, 'skills').props.value, 'Manual skill', 'Extraction preserves existing skills');
  find(preserved.tree, node => node.type === 'ResumeSuggestion' && node.props.label === 'academic background').props.onReplace();
  preserved.render();
  equal(input(preserved.tree, 'background').props.value, result.profile.background, 'Explicit replacement applies selected resume field');
  equal(input(preserved.tree, 'experience').props.value, previous.experience, 'Replacing education preserves independent manual fields');
  preserved.review(true);
  preserved.extract(result);
  equal(find(preserved.tree, node => node.type === 'ResumeReview').props.reviewed, false, 'A second extraction requires review again');
  preserved.review(true);
  await preserved.submit({ name: previous.name, goals: previous.goals });
  equal(preserved.sent[0].track, previous.track, 'Resume does not guess a learning track');
  equal(preserved.sent[0].availableStudyTime, previous.availableStudyTime, 'Resume preserves chosen weekly study time');
  equal(preserved.sent[0].goals, previous.goals, 'Resume preserves learning goal');
  equal(preserved.sent[0].id, previous.id, 'Profile identity survives resume integration');

  const pending = harness();
  pending.edit('background', 'Manual background');
  find(pending.tree, node => node.type === 'ResumeUpload').props.onBusyChange(true); pending.render();
  await pending.submit(); equal(pending.sent.length, 0, 'Plan waits for pending extraction');
  find(pending.tree, node => node.type === 'ResumeUpload').props.onBusyChange(false); pending.render();
  await pending.submit(); equal(pending.sent.length, 1, 'Cancelling extraction restores manual onboarding');
}

/** Run against a built mock-mode server to exercise Next's actual bundled route. */
async function productionHttpJourneys(value) {
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash)
    throw new Error('RESUME_BASE_URL must be an HTTP(S) server origin without credentials or query parameters.');
  const base = target.origin;
  const post = async (body, headers = {}) => {
    const response = await originalFetch(`${base}/api/resume`, { method: 'POST', body, headers: { Origin: base, ...headers } });
    equal(response.headers.get('cache-control'), 'no-store', 'Live resume response cannot be cached');
    return { status: response.status, data: await response.json() };
  };
  const uploadFile = (content, name, type) => {
    const form = new FormData();
    form.append('file', new File([content], name, { type }));
    form.append('useClaude', 'false');
    return post(form);
  };
  const createPlan = async profile => {
    const response = await originalFetch(`${base}/api/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }),
    });
    equal(response.status, 200, 'Live curriculum accepts resume-populated profile');
    return response.json();
  };
  for (const [label, content, filename, mime] of [
    ['TXT', resumeText, 'resume.txt', 'text/plain'],
    ['PDF', pdf(), 'resume.pdf', 'application/pdf'],
  ]) {
    const uploaded = await uploadFile(content, filename, mime);
    validResult(uploaded, `Live ${label}`);
    equal(uploaded.data.mode, 'fallback', `Live ${label} uses deterministic extraction without consent`);
    check(uploaded.data.profile.background.includes('Bachelor of Science in Statistics'), `Live ${label} education populates`);
    check(uploaded.data.profile.experience.includes('Data Analyst'), `Live ${label} experience populates`);
    check(uploaded.data.profile.skills.some(skill => /python/i.test(skill)), `Live ${label} technical skills populate`);
    const profile = {
      id: 'http-resume-test', name: 'Jordan', ...uploaded.data.profile,
      goals: 'Analyze customer retention', availableStudyTime: 5, track: 'data-science',
    };
    const generated = await createPlan(profile);
    equal(generated.mode, 'mock', 'Live HTTP regression server uses mock curriculum mode');
    check(generated.plan.summary.includes(profile.background), `Live ${label} background affects curriculum`);
    const beginner = await createPlan({ ...profile, background: 'High school', experience: '', skills: [] });
    check(generated.plan.modules.some((module, index) => module.estimatedDuration < beginner.plan.modules[index].estimatedDuration), `Live ${label} demonstrated skills affect curriculum pacing`);
    console.log(`${label}: upload 200, editable fields populated, curriculum 200, personalization verified`);
  }
  for (const [label, content, filename, mime, status] of [
    ['Malformed PDF', '%PDF-1.4 broken', 'broken.pdf', 'application/pdf', 422],
    ['Scanned PDF', pdf({ scanned: true }), 'scanned.pdf', 'application/pdf', 400],
    ['Oversized TXT', Buffer.alloc(2 * 1024 * 1024 + 1, 65), 'large.txt', 'text/plain', 413],
    ['Unsupported file', resumeText, 'resume.docx', 'application/octet-stream', 415],
    ['PDF over page budget', pdf({ pages: 21 }), 'long.pdf', 'application/pdf', 422],
  ]) {
    const result = await uploadFile(content, filename, mime);
    equal(result.status, status, `Live ${label} has the expected status`);
    rejected(result, `Live ${label}`);
    console.log(`${label}: safely rejected ${status}`);
  }
  const hostile = await post(JSON.stringify({ text: resumeText, useClaude: false }), { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' });
  equal(hostile.status, 403, 'Live browser-origin validation rejects hostile origins');
  console.log(`PASS ${assertions} live HTTP resume assertions against the production bundle.`);
}

const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;
(async () => {
  try {
    if (process.env.RESUME_BASE_URL) {
      await productionHttpJourneys(process.env.RESUME_BASE_URL);
      return;
    }
    const result = await textAndPdf();
    await rejectedInputs();
    await providerExtraction();
    await curriculumCompatibility();
    await uploadJourneys(result);
    await formJourneys(result);
    console.log(`PASS ${assertions} resume assertions: real TXT/PDF parsing, provider grounding and privacy, upload rejection, manual onboarding, and reviewed editable curriculum generation.`);
    console.log('Provider transport is stubbed; no credentials or live API calls are required.');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
