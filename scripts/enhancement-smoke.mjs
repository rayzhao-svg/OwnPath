/** Real HTTP checks for learning enhancements. Use an isolated, unconfigured server. */
import assert from 'node:assert/strict';

const target = new URL(process.env.BASE_URL ?? 'http://127.0.0.1:3004');
assert(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password &&
  target.pathname === '/' && !target.search && !target.hash, 'BASE_URL must be a server origin without credentials.');
const base = target.origin;
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const check = (value, label) => { assert.ok(value, label); assertions++; };
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function request(endpoint, body, { status = 200, origin = base, raw = false, method = 'POST', noStore = false } = {}) {
  const response = await fetch(`${base}/api/${endpoint}`, {
    method,
    headers: { Origin: origin, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: raw ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  equal(response.status, status, `${endpoint}: HTTP ${status}`);
  check(response.headers.get('content-type')?.includes('application/json'), `${endpoint}: JSON response`);
  if (noStore) equal(response.headers.get('cache-control'), 'no-store', `${endpoint}: response is not cached`);
  const data = await response.json();
  check(!/sk-ant-[a-z0-9_-]+|Bearer\s+\S+|Ocp-Apim-Subscription-Key/i.test(JSON.stringify(data)), `${endpoint}: response does not disclose credentials`);
  if (status >= 400) check(typeof data.error?.message === 'string' && data.error.message.length > 0, `${endpoint}: safe user-readable error`);
  return data;
}

function verifyQuiz(response, lesson, count, excluded) {
  equal(response.mode, 'mock', 'Enhancement smoke requires an isolated mock server');
  equal(response.lessonId, lesson.id, 'Refreshed quiz retains lesson identity');
  equal(response.moduleId, lesson.moduleId, 'Refreshed quiz retains module identity');
  equal(response.quiz.length, count, `Selected count ${count} is returned exactly`);
  equal(new Set(response.quiz.map(question => question.id)).size, count, 'Question IDs are unique');
  const prior = new Set(excluded.map(normalize));
  for (const question of response.quiz) {
    check(!prior.has(normalize(question.question)), 'Fresh questions do not repeat excluded stems');
    prior.add(normalize(question.question));
    equal(question.options.length, 4, 'Each question has four options');
    equal(new Set(question.options.map(normalize)).size, 4, 'Answer options are distinct');
    check(Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer < 4 && question.explanation, 'Answer key and explanation are present');
  }
}

try {
  const profile = {
    id: 'enhancement-smoke-learner', name: 'Synthetic Learner',
    background: 'Business degree with introductory statistics', experience: 'Analyzed reports using spreadsheets',
    skills: ['Excel'], goals: 'Use Python to analyze customer data', availableStudyTime: 5, track: 'data-science',
  };
  const planned = await request('plan', { profile });
  equal(planned.mode, 'mock', 'Run only against a server with its Anthropic key disabled');
  const learningModule = planned.plan.modules.find(item => item.status === 'not-started' && !item.prerequisites.length);
  check(learningModule, 'Mock curriculum has an available foundation');
  const generated = await request('lesson', { module: learningModule });
  equal(generated.mode, 'mock', 'Initial teaching comes from the mock catalog');
  const original = generated.lesson;
  const detailed = await request('lesson/detail', { lesson: original, module: learningModule }, { noStore: true });
  equal(detailed.mode, 'mock', 'Unconfigured detail mode is explicit');
  const lesson = detailed.lesson;
  equal([lesson.id, lesson.moduleId, lesson.title], [original.id, original.moduleId, original.title], 'Teaching expansion preserves lesson identity');
  equal(lesson.quiz, original.quiz, 'Teaching expansion leaves the assessment intact');
  equal(lesson.slides.map(slide => [slide.id, slide.title, slide.bullets]), original.slides.map(slide => [slide.id, slide.title, slide.bullets]), 'Teaching expansion preserves slide identity and context');
  for (const slide of lesson.slides) {
    check(slide.scenes?.length > 0, 'Saved narration receives teaching scenes');
    equal(slide.narration, slide.scenes.map(scene => scene.narration).join(' '), 'Transcript matches ordered scene narration exactly');
    check(slide.scenes.every(scene => scene.title && scene.visual.lines.length > 0), 'Each scene has visible teaching content');
  }

  const initialStems = lesson.quiz.map(question => question.question);
  const first = await request('quiz', { lesson, previousQuestions: initialStems, questionCount: 5 }, { noStore: true });
  verifyQuiz(first, lesson, 5, initialStems);
  const firstLesson = { ...lesson, quiz: first.quiz };
  const excluded = [...initialStems, ...first.quiz.map(question => question.question)];
  const second = await request('quiz', { lesson: firstLesson, previousQuestions: excluded, questionCount: 10 }, { noStore: true });
  verifyQuiz(second, firstLesson, 10, excluded);
  const activeLesson = { ...lesson, quiz: second.quiz };
  check(second.quiz.every(question => !first.quiz.some(old => old.id === question.id)), 'A retry generates fresh question IDs');

  const answers = Object.fromEntries(first.quiz.map((question, index) => [question.id,
    index < 3 ? question.correctAnswer : (question.correctAnswer + 1) % question.options.length]));
  const missedQuestionIds = first.quiz.filter(question => answers[question.id] !== question.correctAnswer).map(question => question.id);
  const result = {
    lessonId: lesson.id, moduleId: lesson.moduleId, totalQuestions: 5, correctAnswers: 3,
    score: 60, passed: false, completedAt: new Date().toISOString(), answers,
    missedQuestionIds, questions: first.quiz,
  };
  const reviewed = await request('review', { lesson: activeLesson, result }, { noStore: true });
  equal(reviewed.mode, 'mock', 'Historical review remains available without a provider');
  equal(reviewed.review.attemptedAt, result.completedAt, 'Review belongs to the historical attempt');
  equal(reviewed.review.areas.map(area => area.questionId).sort(), [...missedQuestionIds].sort(), 'Review references the old five-question snapshot after switching to ten');
  check(reviewed.review.areas.every(area => !second.quiz.some(question => question.id === area.questionId)), 'Review never substitutes current question IDs for old mistakes');
  const chatted = await request('chat', { lesson: activeLesson, question: 'What score do I need to pass the quiz?', messages: [] });
  equal(chatted.mode, 'mock', 'Passing guidance uses the mock tutor');
  check(chatted.message.content.includes('you need at least 7 of 10 correct'), 'Tutor explains the actual ten-question passing threshold');

  for (const questionCount of [4, 11]) {
    const invalid = await request('quiz', { lesson, previousQuestions: [], questionCount }, { status: 400, noStore: true });
    equal(invalid.error.code, 'VALIDATION_ERROR', 'Out-of-range quiz count is rejected');
  }
  await request('quiz', { lesson, previousQuestions: [], questionCount: 5 }, { status: 403, origin: 'https://untrusted.example', noStore: true });
  await request('lesson/detail', '{invalid', { status: 400, raw: true, noStore: true });
  await request('lesson/detail', { lesson, module: { ...learningModule, id: 'different-module' } }, { status: 400, noStore: true });

  const narration = await request('narration', undefined, { method: 'GET', noStore: true });
  equal(narration, { available: false, voice: 'Amanda Multilingual', voiceId: 'en-US-AmandaMultilingualNeural' }, 'Isolated server exposes voice identity without credentials');
  await request('narration', { text: 'A synthetic narration check.' }, { status: 503, noStore: true });
  await request('narration', { text: 'A synthetic narration check.' }, { status: 403, origin: 'https://untrusted.example', noStore: true });
  console.log(`PASS ${assertions} enhancement HTTP assertions: detailed scenes, selectable fresh quizzes, historical reviews, passing guidance, and narration errors.`);
  console.log('Synthetic data only; mock mode was required and no browser learner state was modified.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Enhancement HTTP smoke failed.');
  process.exitCode = 1;
}
