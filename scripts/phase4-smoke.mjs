/** Real HTTP Phase 4 journeys. Uses synthetic resumes; never reads credentials. */
import assert from 'node:assert/strict';

const target = new URL(process.env.BASE_URL ?? 'http://127.0.0.1:3001');
assert(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password &&
  target.pathname === '/' && !target.search && !target.hash, 'BASE_URL must be a server origin without credentials.');
const base = target.origin;
const marker = 'OWNPATH_SYNTHETIC_PRIVATE_CONTACT_MARKER_4AB';
const email = 'synthetic.ownpath.contact@example.invalid';
const goal = 'Use Python to analyze customer retention and evaluate a simple churn prediction baseline.';
let assertions = 0;
const failures = [];
const reports = [];
function check(condition, label) { assert.ok(condition, label); assertions++; }
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
function privacy(data, label) {
  const serialized = JSON.stringify(data);
  check(!serialized.includes(marker) && !serialized.includes(email), `${label}: source contact data must not enter generated content`);
  check(!/sk-ant-[a-z0-9_-]+|Bearer\s+\S+/i.test(serialized), `${label}: generated content must not include credentials`);
}
async function request(endpoint, body, { multipart = false, expected = 200, origin = base } = {}) {
  const started = Date.now();
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST',
    headers: { Origin: origin, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(40_000),
  });
  const data = await response.json();
  const evidence = { endpoint, status: response.status, elapsedMs: Date.now() - started,
    ...(data.mode ? { mode: data.mode } : {}), ...(data.fallbackReason ? { fallbackReason: data.fallbackReason } : {}),
    ...(data.error?.code ? { errorCode: data.error.code } : {}) };
  console.log(JSON.stringify(evidence));
  if (expected !== undefined && response.status !== expected) {
    // Preserve configured-provider failures as failures; never relabel them mock.
    throw new Error(`${endpoint}: expected HTTP ${expected}, received ${response.status}${data.error?.code ? ` (${data.error.code})` : ''}`);
  }
  assertions++;
  if (response.ok || endpoint === 'resume') equal(response.headers.get('cache-control'), 'no-store', `${endpoint}: private response uses no-store`);
  if (endpoint !== 'resume') privacy(data, endpoint);
  return { data, status: response.status, evidence };
}
function validatePlan(plan, profile) {
  equal(plan.profileId, profile.id, 'Curriculum belongs to edited learner profile');
  equal(plan.track, profile.track, 'Curriculum preserves chosen track');
  equal(plan.weeklyStudyHours, profile.availableStudyTime, 'Curriculum preserves weekly budget');
  check(Array.isArray(plan.modules) && plan.modules.length >= 1 && plan.modules.length <= 50, 'Curriculum has bounded modules');
  const byId = new Map(plan.modules.map(module => [module.id, module]));
  equal(byId.size, plan.modules.length, 'Curriculum module IDs are unique');
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    check(byId.has(id), 'Prerequisites reference modules from the same curriculum');
    check(!visiting.has(id), 'Curriculum prerequisite graph is acyclic');
    if (visited.has(id)) return;
    const learningModule = byId.get(id);
    visiting.add(id);
    check(Array.isArray(learningModule.topics) && learningModule.topics.length > 0, 'Modules contain lesson topics');
    check(learningModule.resources.every(resource => new URL(resource.url).protocol === 'https:'), 'Resource URLs use HTTPS');
    learningModule.prerequisites.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  plan.modules.forEach(module => visit(module.id));
  check(plan.modules.some(module => module.status === 'not-started' && module.prerequisites.length === 0), 'Curriculum starts with an available foundation');
  check(plan.modules.every(module => !module.prerequisites.length || module.status === 'locked'), 'Unassessed prerequisite modules remain locked');
}
function failedAttempt(lesson) {
  const answers = Object.fromEntries(lesson.quiz.map((question, index) => [question.id,
    index === 0 ? question.correctAnswer : (question.correctAnswer + 1) % question.options.length]));
  const correctAnswers = lesson.quiz.filter(question => answers[question.id] === question.correctAnswer).length;
  const score = Math.round(correctAnswers / lesson.quiz.length * 100);
  check(score < 70, 'Synthetic assessment intentionally fails');
  return {
    lessonId: lesson.id, moduleId: lesson.moduleId, answers, correctAnswers,
    totalQuestions: lesson.quiz.length, score, passed: false, completedAt: new Date().toISOString(),
    missedQuestionIds: lesson.quiz.filter(question => answers[question.id] !== question.correctAnswer).map(question => question.id),
  };
}
async function journey(label, resumeLines, edits) {
  const resume = [marker, email, ...resumeLines].join('\n');
  const form = new FormData();
  form.append('file', new File([resume], `synthetic-${label}.txt`, { type: 'text/plain' }));
  form.append('useClaude', 'false');
  const uploaded = await request('resume', form, { multipart: true });
  equal(uploaded.data.mode, 'fallback', 'Resume extraction uses local rules without Claude consent');
  check(uploaded.data.profile.background.length > 0 && Array.isArray(uploaded.data.profile.skills), 'Resume extracts editable education and skills');
  privacy(uploaded.data.profile, 'Extracted profile');
  const profile = {
    id: `phase4-http-${label}`, name: 'Synthetic Learner', ...uploaded.data.profile,
    ...edits, goals: goal, availableStudyTime: 5, track: 'data-science',
  };
  privacy(profile, 'Edited learner profile');
  const planned = await request('plan', { profile });
  check(['mock', 'claude'].includes(planned.data.mode), 'Curriculum declares its content mode');
  validatePlan(planned.data.plan, profile);
  const plan = planned.data.plan;
  const learningModule = plan.modules.find(item => item.status === 'not-started' && !item.prerequisites.length);
  const generated = await request('lesson', { module: learningModule });
  const lesson = generated.data.lesson;
  equal(lesson.moduleId, learningModule.id, 'Generated lesson belongs to selected curriculum module');
  equal(lesson.title, learningModule.title, 'Generated lesson preserves selected module title');
  check(lesson.slides.length >= 4 && lesson.slides.length <= 30, 'Lesson has bounded teaching slides');
  check(lesson.quiz.length >= 3 && lesson.quiz.length <= 20, 'Lesson has bounded assessment questions');
  check(lesson.slides.every(slide => slide.bullets.length && slide.narration), 'Lesson includes visible content and narration');
  check(lesson.quiz.every(question => Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer < question.options.length && question.explanation), 'Assessment answers and explanations are valid');
  const slide = lesson.slides[1];
  const chatted = await request('chat', {
    lesson, question: `[OwnPath slide: ${slide.id}]\nExplain the central idea on this slide using one small worked example.`, messages: [],
  });
  equal(chatted.data.message.role, 'assistant', 'Contextual question receives tutor response');
  check(typeof chatted.data.message.content === 'string' && chatted.data.message.content.length > 20, 'Tutor returns educational content');
  const result = failedAttempt(lesson);
  const reviewed = await request('review', { lesson, result });
  const review = reviewed.data.review;
  equal(review.lessonId, lesson.id, 'Targeted review references selected lesson');
  equal(review.attemptedAt, result.completedAt, 'Targeted review references exact failed attempt');
  equal([...review.areas.map(area => area.questionId)].sort(), [...result.missedQuestionIds].sort(), 'Targeted review covers exactly the missed questions');
  check(review.areas.every(area => lesson.slides.some(item => item.id === area.slideId) && area.concept && area.explanation && area.workedExample && area.steps.length >= 2), 'Targeted review supplies grounded explanations, examples, and actions');
  const invalid = await request('review', { lesson, result: { ...result, score: 100 } }, { expected: 400 });
  equal(invalid.data.error.code, 'VALIDATION_ERROR', 'Inconsistent score is rejected before review');
  const report = {
    profile: label, resumeMode: uploaded.data.mode,
    modes: { plan: planned.data.mode, lesson: generated.data.mode, chat: chatted.data.mode, review: reviewed.data.mode },
    ...(reviewed.data.fallbackReason ? { reviewFallback: reviewed.data.fallbackReason } : {}),
    curriculum: plan.modules.map(item => ({ title: item.title, topics: item.topics, minutes: item.estimatedDuration })),
    slides: lesson.slides.length, questions: lesson.quiz.length, missed: result.missedQuestionIds.length, reviewAreas: review.areas.length,
  };
  reports.push(report);
  console.log(JSON.stringify(report));
  return { profile, plan, mode: planned.data.mode };
}

try {
  const invalidResume = new FormData();
  invalidResume.append('file', new File(['Unsupported synthetic document'], 'synthetic.docx', { type: 'application/octet-stream' }));
  const unsupported = await request('resume', invalidResume, { multipart: true, expected: 415 });
  equal(unsupported.data.error.code, 'RESUME_ERROR', 'Unsupported resume has safe typed error');
  await request('resume', { text: 'synthetic text', useClaude: false }, { expected: 403, origin: 'https://untrusted.example' });
  const outcomes = [];
  for (const [label, lines, edits] of [
    ['beginner', ['Education', 'High school diploma with algebra coursework', 'Experience', 'Prepared monthly business reports in Excel', 'Skills', 'Excel'], { experience: 'Prepared monthly reports using Excel; introductory algebra coursework.', skills: ['Excel'] }],
    ['experienced', ['Education', 'Bachelor of Science in Statistics', 'Experience', 'Three years analyzing customer data with Python and SQL', 'Skills', 'Python, Statistics, pandas, SQL'], { experience: 'Three years of Python and SQL customer analysis; built pandas data pipelines.', skills: ['Python', 'Statistics', 'pandas', 'SQL'] }],
  ]) {
    try { outcomes.push(await journey(label, lines, edits)); }
    catch (error) { failures.push({ profile: label, message: error instanceof Error ? error.message : 'Unexpected journey failure' }); }
  }
  if (outcomes.length === 2) {
    equal(outcomes[0].profile.goals, outcomes[1].profile.goals, 'Both profiles use exactly the same learning goal');
    const fingerprint = item => JSON.stringify(item.plan.modules.map(module => ({ title: module.title, topics: module.topics, description: module.description, minutes: module.estimatedDuration })));
    check(fingerprint(outcomes[0]) !== fingerprint(outcomes[1]), 'Different existing skills produce different curricula or pacing');
    if (outcomes.every(item => item.mode === 'mock')) check(outcomes[1].plan.modules.some((module, index) => module.estimatedDuration < outcomes[0].plan.modules[index].estimatedDuration), 'Experienced mock profile condenses relevant foundations');
  }
} catch (error) {
  failures.push({ profile: 'validation', message: error instanceof Error ? error.message : 'Unexpected HTTP validation failure' });
}
console.log(JSON.stringify({ result: failures.length ? 'FAIL' : 'PASS', base, assertions, completedProfiles: reports.length, failures }));
if (failures.length) process.exitCode = 1;
