/* eslint-disable @typescript-eslint/no-require-imports */
/** Large stored courses must remain usable through the bounded API contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NativeModule = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), modules = new Map();
let assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const equal = (value, expected, label) => { assert.deepEqual(value, expected, label); assertions++; };
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const item = { exports: {} }; modules.set(filename, item);
  let code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  if (relative === 'lib/learning-context.tsx') code += '\nexports.restoreForTest = restoreState;';
  const nativeRequire = NativeModule.createRequire(filename);
  const requireLocal = name => name === 'server-only' ? {} : name.startsWith('@/')
    ? load(['.ts', '.tsx'].map(extension => name.slice(2) + extension).find(file => fs.existsSync(path.join(root, file))))
    : nativeRequire(name);
  new Function('exports', 'require', 'module', code)(item.exports, requireLocal, item);
  return item.exports;
}
const roles = ['prerequisites', 'concept', 'reasoning', 'worked-example', 'pitfall', 'guided-practice', 'independent-practice'];
function courseFixture(chapters = 12) {
  const quiz = Array.from({ length: 10 }, (_, index) => ({
    id: `question-${index}`, question: `Apply retention principle ${index + 1} to customer evidence.`,
    options: ['Compare matching customer counts', 'Ignore all customer dates', 'Discard every denominator', 'Assume retention is perfect'],
    correctAnswer: 0, explanation: 'Compare customer counts using the same observation window. '.repeat(8).trim(),
  }));
  return {
    id: 'large-context-course', moduleId: 'data-science-01', title: 'Retention analysis', teachingVersion: 2,
    slides: Array.from({ length: chapters }, (_, chapter) => {
      const scenes = roles.map((role, index) => ({
        title: `${role}: retention chapter ${chapter + 1}`, role,
        narration: `Chapter ${chapter + 1}, step ${index + 1}. ` + 'Match retained customers to the original observation window and explain each intermediate quantity. '.repeat(18) + ` Exact worked result ${chapter + 1}-${index + 1}: 8 / 10 = 0.8.`,
        visual: { kind: 'calculation', lines: Array.from({ length: 5 }, (_, line) => `Quantity ${line + 1}: compare retained customer evidence before dividing by the original cohort. `.repeat(2).padEnd(240, ' ')) },
      }));
      return {
        id: `chapter-${chapter + 1}`, title: `Retention chapter ${chapter + 1}`,
        learningObjective: `Explain retention principle ${chapter + 1} using consistent customer evidence.`,
        overview: `Retention principle ${chapter + 1}: match the numerator and denominator to one observation window.`,
        bullets: [`Retention principle ${chapter + 1}`, 'Use one consistent customer observation window.', 'Explain intermediate counts before calculating a rate.'],
        scenes, narration: scenes.map(scene => scene.narration).join(' '), teachingVersion: 2, qualityVersion: 1,
      };
    }), quiz,
  };
}
const { compactLessonContext, DEFAULT_LESSON_CONTEXT_BYTES } = load('lib/lesson-context.ts');
const { assertLessonRequestBudget, MAX_STORED_LESSON_BYTES } = load('lib/lesson-budget.ts');
const { assertLesson } = load('lib/validators.ts');
const { assertQuizRefreshResponse } = load('lib/quiz-refresh.ts');
const { diagnoseMistakes, assertReviewResponse, createMockReview } = load('lib/remediation.ts');
const course = courseFixture(), before = JSON.stringify(course);
assertLesson(course); assertions++;
check(bytes(course) > 200 * 1024, 'The regression course exceeds the old request and lesson budgets by a wide margin');
assertLessonRequestBudget(course); assertions++;
const context = compactLessonContext(course);
assertLesson(context); assertions++;
check(bytes(context) <= DEFAULT_LESSON_CONTEXT_BYTES, 'A large stored course projects below the forty-KiB request-context budget');
equal(context.slides.map(slide => [slide.id, slide.title, slide.bullets, slide.overview, slide.learningObjective]), course.slides.map(slide => [slide.id, slide.title, slide.bullets, slide.overview, slide.learningObjective]), 'Every chapter identity, objective, overview, and topic survives projection exactly');
check(context.slides.every(slide => !('scenes' in slide)), 'Requests omit duplicate scene objects and audio alignment data');
check(context.slides.every(slide => slide.qualityVersion === 1), 'Compact contexts retain verified chapter quality metadata');
equal(context.quiz, course.quiz, 'Question identities, options, correct answers, and explanations remain exact');
equal(JSON.stringify(course), before, 'Projection does not mutate the full saved course');

const focused = compactLessonContext(course, { focusSlideIds: ['chapter-6'] });
check(bytes(focused) <= DEFAULT_LESSON_CONTEXT_BYTES, 'Focused requests remain bounded');
for (let index = 0; index < roles.length; index++)
  check(focused.slides[5].narration.includes(`Exact worked result 6-${index + 1}: 8 / 10 = 0.8.`), 'Focused context retains the exact reasoning and results from every teaching section');
check(focused.slides[5].narration.length > focused.slides[0].narration.length, 'The active chapter receives richer teaching context');
const unicode = structuredClone(course);
unicode.slides.forEach(slide => { slide.scenes.forEach(scene => { scene.narration = scene.narration.replaceAll('customer', '学习者'); }); slide.narration = slide.scenes.map(scene => scene.narration).join(' '); });
check(bytes(compactLessonContext(unicode, { maxBytes: 30 * 1024 })) <= 30 * 1024, 'Context limits count UTF-8 bytes rather than JavaScript characters');
assert.throws(() => compactLessonContext(course, { maxBytes: 1000 }), /outline and assessment/); assertions++;
equal(JSON.stringify(course), before, 'A context-budget failure also preserves the saved course');

const fresh = course.quiz.map((question, index) => ({ ...question, id: `fresh-${index}`, question: `Which customer evidence supports retention in fresh scenario ${index + 1}?` }));
assertQuizRefreshResponse({ lessonId: course.id, moduleId: course.moduleId, quiz: fresh, mode: 'claude' }, course, [], 10); assertions++;
const result = {
  lessonId: course.id, moduleId: course.moduleId, correctAnswers: 0, totalQuestions: 10, score: 0, passed: false,
  completedAt: '2026-10-31T12:00:00.000Z', answers: Object.fromEntries(course.quiz.map(question => [question.id, 1])),
  missedQuestionIds: course.quiz.map(question => question.id), questions: structuredClone(course.quiz),
};
const reviewContext = compactLessonContext(course, { maxBytes: 48 * 1024 - bytes(result) });
check(bytes({ lesson: reviewContext, result }) < 60 * 1024, 'Review requests retain the complete scored snapshot within the HTTP request budget');
equal(diagnoseMistakes(reviewContext, result), diagnoseMistakes(course, result), 'Review concepts and chapter associations are stable between saved teaching and request excerpts');
const review = createMockReview({ lesson: reviewContext, result });
assertReviewResponse(review, course, result); assertions++;

const legacy = { ...course, slides: course.slides.map(({ overview, ...slide }) => ({ ...slide, learningObjective: overview })) };
equal(diagnoseMistakes(compactLessonContext(legacy), result), diagnoseMistakes(legacy, result), 'Legacy chapters without stable overviews keep the same review associations');
equal(diagnoseMistakes(course, result), diagnoseMistakes(legacy, result), 'Adding stable overviews during a legacy teaching upgrade cannot move saved review concepts');
const oversized = courseFixture(30);
check(bytes(oversized) > MAX_STORED_LESSON_BYTES, 'The oversized storage fixture crosses the explicit per-course ceiling');
assert.throws(() => assertLessonRequestBudget(oversized), /too large to save/); assertions++;

const { createMockPlan } = load('lib/mock-data.ts');
const profile = { id: 'course-storage-learner', name: 'Alex', background: 'Statistics', experience: '', skills: ['Excel'], goals: 'Analyze customer retention', availableStudyTime: 40, track: 'data-science' };
const plan = createMockPlan(profile);
course.moduleId = plan.modules[0].id;
course.title = plan.modules[0].title;
plan.modules[0].status = 'completed';
const passed = { ...result, moduleId: course.moduleId, correctAnswers: 10, score: 100, passed: true, answers: Object.fromEntries(course.quiz.map(question => [question.id, 0])), missedQuestionIds: [] };
const { restoreForTest } = load('lib/learning-context.tsx');
const restored = restoreForTest(JSON.stringify({ version: 1, profile, plan, lessons: { [course.moduleId]: course }, quizResults: { [course.moduleId]: passed }, planGeneration: 'large-course-generation' }));
check(restored !== null, 'A full expanded course restores from version-one persistence');
equal(restored.lessons[course.moduleId], course, 'Persistence keeps every expanded scene and exact visual');
equal(restored.quizResults[course.moduleId], passed, 'Large-course persistence preserves the passing assessment and scored questions');
equal(restored.plan.modules[0].status, 'completed', 'Course growth never resets earned completion');

async function reviewWireChecks() {
  const { requestReviewResponse } = load('lib/api-client.ts');
  const route = load('app/api/review/route.ts');
  const historicalQuestions = course.quiz.map((question, index) => ({
    ...question, id: `historical-${index}`,
    question: `Which customer counts support retention in historical scenario ${index + 1}? `.padEnd(480, 'x'),
    options: ['A', 'B', 'C', 'D'].map(value => `${value}: compare customer evidence within the same observation window. `.padEnd(245, value)),
    explanation: 'Compare the original customer cohort and the retained customer count using one observation window. '.padEnd(680, 'x'),
  }));
  const historicalResult = {
    ...result, questions: historicalQuestions,
    answers: Object.fromEntries(historicalQuestions.map(question => [question.id, 1])),
    missedQuestionIds: historicalQuestions.map(question => question.id),
  };
  const originalResult = JSON.stringify(historicalResult), savedCourse = { ...course, quiz: fresh };
  check(bytes(historicalQuestions) > 20 * 1024, 'The historical quiz approaches the allowed generated-assessment size');
  const originalFetch = global.fetch, originalKey = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = async (url, options) => {
      equal(url, '/api/review', 'Historical review uses the real review endpoint');
      const body = JSON.parse(options.body);
      check(bytes(body) < 60 * 1024, 'A large historical assessment and compact course remain below the outgoing review budget');
      equal(body.lesson.quiz, historicalQuestions, 'The scored historical questions travel exactly once as the request lesson quiz');
      equal(body.result.questions, undefined, 'The wire result omits the duplicate question snapshot');
      const response = await route.POST(new Request('http://localhost/api/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: options.body,
      }));
      equal(response.status, 200, 'Server attempt validation accepts the exact historical quiz without a duplicate snapshot');
      return response;
    };
    const response = await requestReviewResponse(savedCourse, historicalResult);
    equal(response.review.areas.map(area => area.questionId), historicalQuestions.map(question => question.id), 'Review diagnostics refer to historical questions rather than the currently active quiz');
    equal(JSON.stringify(historicalResult), originalResult, 'Wire deduplication never changes the saved attempt snapshot or answers');
    equal(savedCourse.quiz, fresh, 'Reviewing a historical attempt leaves the active assessment unchanged');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
}
reviewWireChecks().then(() => {
  console.log(`PASS ${assertions} lesson context assertions: bounded excerpts, exact chapter outlines and assessments, active-chapter reasoning, stable remediation, historical review requests, and large-course persistence.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
