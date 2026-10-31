/* eslint-disable @typescript-eslint/no-require-imports */
/** Substantial course/chapter generation contracts with stubbed transport. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), NativeModule = require('node:module');
const ts = require('typescript'), root = path.resolve(__dirname, '..'), modules = new Map();
let assertions = 0;
const equal = (value, expected, label) => { assert.deepEqual(value, expected, label); assertions++; };
const check = (value, label) => { assert.ok(value, label); assertions++; };
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
const { generateLessonResponse, COURSE_CHAPTER_KEYS } = load('lib/claude-lesson.ts');
const { generateLessonDetail } = load('lib/lesson-detail.ts');
const { COURSE_SECTIONS, reviewChapterDraft } = load('lib/course-chapter.ts');
const learningModule = {
  id: 'claude-advanced-bellman', title: 'Bellman reasoning and value iteration',
  description: 'Advanced reinforcement learning: derive and implement Bellman updates with checked numerical examples and research-level assumptions.',
  prerequisites: [], resources: [], estimatedDuration: 4200, status: 'not-started',
  topics: ['Markov decision processes', 'Discounted returns', 'Bellman equations', 'Value iteration'],
};
function outlineDraft() {
  const titles = ['State, action, and reward', 'Transition dynamics', 'Discounted returns', 'Policy values', 'Bellman expectation equations', 'Bellman optimality equations', 'Value iteration', 'Check a converged solution'];
  return {
    chapters: Object.fromEntries(COURSE_CHAPTER_KEYS.map((key, index) => [key, {
      title: titles[index], learningObjective: `Explain and apply ${titles[index].toLowerCase()} in a Markov decision process.`,
      bullets: ['Define every state, action, reward, and transition used in the example.', 'Compute a Bellman update and check the intermediate values.'],
      overview: 'A Markov decision process connects states, actions, rewards, and transitions. Use a small specified example to connect this chapter to the previous one, then check the Bellman value calculation before moving on.',
    }])),
    quiz: ['Choose a discount factor', 'Interpret a value estimate', 'Check a Bellman update'].map((question, index) => ({
      question, options: ['Use the stated transition probabilities', 'Ignore the rewards', 'Drop the discount factor', 'Count states without transitions'],
      correctAnswer: 0, explanation: `Diagnostic ${index + 1}: use the specified rewards, transitions, and discount factor consistently.`,
    })),
  };
}
function chapterDraft() {
  const explanation = [
    'A state describes the information needed to predict the next reward and transition once an action is chosen. In this illustrative Markov decision process, use states A and B, one allowed action, and a discount factor of one half. Define the reward and transition before calculating a value, because a value depends on the model rather than on the state name alone.',
    'Begin with a value estimate of zero for both states. Suppose the action from A earns two units of reward and moves to B with probability one. The Bellman update adds the immediate reward to the discounted value estimate for the next state. Substituting these stated inputs gives two plus one half times zero, so the updated estimate for A is two.',
    'Check each part of that calculation before interpreting it. The reward is received now, while the next-state estimate represents later rewards and is therefore discounted. This single update is an estimate based on the current values, not proof that iteration has converged. If the next-state estimate changes, repeat the same update with the new value and compare the result.',
  ];
  return Object.fromEntries(Object.keys(COURSE_SECTIONS).map((key, index) => [key, {
    title: ['Define the model', 'Derive the update', 'Trace a numerical example', 'Diagnose a mistaken update', 'Practice with a hint and solution', 'Try a changed reward and self-check', 'Connect the result to iteration'][index],
    visualKind: index === 2 ? 'calculation' : 'concept',
    steps: [
      { line: 'States: A and B; discount gamma = 0.5', narration: explanation[0] },
      { line: 'V_new(A) = 2 + 0.5 * V_old(B) = 2', narration: explanation[1] },
      { line: 'Check: immediate reward + discounted next-state value', narration: explanation[2] },
    ],
  }]));
}
let calls = [];
function provider(draft, options = {}) {
  calls = [];
  global.fetch = async (url, init) => {
    equal(url, 'https://api.anthropic.com/v1/messages', 'Course content stays behind the existing provider boundary');
    const body = JSON.parse(init.body);
    calls.push({ body, signal: init.signal });
    const isReview = body.output_config.format.schema.required.includes('corrections');
    const result = isReview ? options.review ?? { corrections: [] } : draft;
    return Response.json({ stop_reason: options.stopReason ?? 'end_turn', content: [{ type: 'text', text: JSON.stringify(result) }] });
  };
}
const original = { fetch: global.fetch, key: process.env.ANTHROPIC_API_KEY };
(async () => {
  try {
    process.env.ANTHROPIC_API_KEY = 'OFFLINE-COURSE-TEST-KEY';
    provider(outlineDraft());
    const generated = await generateLessonResponse({ module: learningModule });
    equal(generated.mode, 'claude', 'A live-adapter course outline retains its source mode');
    const lesson = generated.lesson;
    equal(lesson.teachingVersion, 2, 'The new outline has explicit upgrade metadata');
    equal(lesson.slides.length, 8, 'A course has eight ordered topic chapters rather than four overview slides');
    equal(lesson.slides.map(slide => slide.title), Object.values(outlineDraft().chapters).map(chapter => chapter.title), 'Course topic order is preserved');
    check(lesson.slides.every(slide => slide.learningObjective && slide.overview === slide.narration && !slide.teachingVersion), 'Every chapter retains its objective and stable introduction until substantial teaching is loaded');
    check(calls[0].body.system.includes('advanced technical chapters') && calls[0].body.system.includes('Build prerequisites before using them'), 'The author must calibrate depth and course coherence');
    equal(calls[0].body.output_config.format.schema.properties.chapters.required.length, 8, 'Native schema requires every chapter instead of relying on array cardinality guessing');
    const saved = clone(lesson), target = lesson.slides[4];
    provider(chapterDraft());
    const response = await generateLessonDetail({ lesson, module: learningModule, slideId: target.id });
    equal(Object.keys(response).sort(), ['lessonId', 'mode', 'moduleId', 'slide'], 'A chapter response is a patch rather than a replacement course or assessment');
    equal(response.lessonId, lesson.id, 'The original course identity is preserved');
    equal(response.slide.id, target.id, 'The original chapter identity is preserved');
    equal(response.slide.title, target.title, 'The original topic title is preserved');
    equal(response.slide.bullets, target.bullets, 'Original topic coverage is preserved');
    equal(response.slide.learningObjective, target.learningObjective, 'The learning objective remains stable');
    equal(response.slide.overview, target.overview, 'The introduction survives the full teaching upgrade');
    equal(response.slide.teachingVersion, 2, 'Only the expanded chapter is marked as substantial teaching');
    equal(response.slide.qualityVersion, 1, 'A chapter is reusable only after a separate quality review completes');
    equal(response.slide.scenes.map(scene => scene.role), Object.values(COURSE_SECTIONS), 'Concept, reasoning, worked example, pitfall, guided and independent practice, and synthesis are all required');
    check(response.slide.scenes.every(scene => scene.narration.split(/\s+/).length >= 120), 'The fixture exercises course-length explanations instead of short snippets');
    check(response.slide.scenes.every(scene => scene.lineNarrations.length === scene.visual.lines.length), 'Every displayed step has its own authored spoken explanation');
    check(response.slide.scenes.every(scene => scene.narration === scene.lineNarrations.join(' ')), 'Spoken scene text comes exactly from the aligned step narrations');
    equal(response.slide.narration, response.slide.scenes.map(scene => scene.narration).join(' '), 'The chapter transcript preserves all authored explanations in order');
    equal(lesson, saved, 'Generating a chapter cannot mutate scores, questions, other chapters, or the saved source course');
    const payload = JSON.parse(calls[0].body.messages[0].content);
    equal(payload.chapter.position, 5, 'The author receives the selected chapter position');
    equal(payload.course.chapters.map(chapter => chapter.id), lesson.slides.map(slide => slide.id), 'The entire ordered course outline supplies continuity');
    check(calls[0].body.system.includes('roughly120–220 words') && calls[0].body.system.includes('self-check solution') && calls[0].body.system.includes('intermediate calculations'), 'The teaching contract requires sustained reasoning and complete practice solutions');
    equal(calls.length, 2, 'Generation and an independent compact review each run once');
    const reviewPayload = JSON.parse(calls[1].body.messages[0].content);
    equal(reviewPayload.draft, chapterDraft(), 'The reviewer checks the original paired steps without duplicated transcripts');

    const inconsistent = chapterDraft();
    inconsistent.workedExample.steps[1] = {
      line: 's^2 = 1.5733; SE(integral estimate) = 1.25',
      narration: 'The squared deviations sum to 5.4604. Dividing by three gives a sample variance of 1.8201333, and the standard error of the integral estimate is about 1.3491.',
    };
    const correctedPair = {
      section: 'workedExample', stepIndex: 1,
      line: 's^2 = 5.4604 / 3 = 1.8201333; SE(integral estimate) = 2 * sqrt(s^2 / 4) = 1.3491',
      narration: 'For these illustrative Monte Carlo draws, the squared deviations sum to 5.4604. Dividing by three gives a sample variance of 1.8201333. The standard error of the sample mean is the square root of this variance divided by four; multiplying by the interval length two gives about 1.3491.',
    };
    provider(inconsistent, { review: { corrections: [correctedPair] } });
    const corrected = (await generateLessonDetail({ lesson, module: learningModule, slideId: target.id })).slide;
    const example = corrected.scenes.find(scene => scene.role === 'worked-example');
    equal(example.visual.lines[1], correctedPair.line, 'A reviewed arithmetic correction replaces the erroneous highlighted calculation');
    equal(example.lineNarrations[1], correctedPair.narration, 'The arithmetic correction updates its spoken explanation at the same time');
    check(!corrected.narration.includes('1.5733') && example.narration.includes('1.8201333'), 'The returned transcript uses the reviewed canonical result');
    equal(corrected.scenes[0].narration, response.slide.scenes[0].narration, 'Targeted review leaves correct teaching sections intact');

    const samplingDraft = chapterDraft();
    samplingDraft.guidedPractice.steps[0] = {
      line: 'Use the fixed evenly spaced nodes 0.25, 0.75, 1.25, 1.75; mean = 2.625; MC SE = 1.323',
      narration: 'These points were deliberately chosen on an evenly spaced grid. Treat the calculated Monte Carlo standard error as the uncertainty of this deterministic integral rule.',
    };
    const samplingCorrection = {
      section: 'guidedPractice', stepIndex: 0,
      line: 'Hypothetical iid Uniform(0,2) draws: 0.25, 0.75, 1.25, 1.75; mean = 2.625; SE under iid model = 1.323',
      narration: 'Treat these illustrative values as hypothetical realizations under an iid Uniform(0,2) sampling model. The calculated standard error is conditional on that model; it is not an error estimate for deliberately selected deterministic quadrature nodes.',
    };
    provider(samplingDraft, { review: { corrections: [samplingCorrection] } });
    const reviewedExisting = await reviewChapterDraft(samplingDraft, target, learningModule);
    equal(calls.length, 1, 'An existing chapter can be reviewed without regenerating its teaching');
    const sampledPractice = reviewedExisting.scenes.find(scene => scene.role === 'guided-practice');
    equal(sampledPractice.visual.lines[0], samplingCorrection.line, 'The sampling-design correction keeps the numeric example and makes the iid model explicit');
    equal(sampledPractice.lineNarrations[0], samplingCorrection.narration, 'The spoken sampling assumption matches the corrected display');
    provider(chapterDraft());
    await assert.rejects(reviewChapterDraft(chapterDraft(), target, learningModule, { timeoutMs: 0 }), /took too long to verify/); assertions++;
    equal(calls.length, 0, 'A review without enough remaining time cannot start a provider request');

    for (const corrections of [
      [{ ...correctedPair, section: 'invented-section' }],
      [{ ...correctedPair, stepIndex: 100 }],
      [correctedPair, correctedPair],
      [{ ...correctedPair, line: '' }],
      [{ ...correctedPair, narration: 'x'.repeat(2001) }],
    ]) {
      provider(chapterDraft(), { review: { corrections } });
      await assert.rejects(generateLessonDetail({ lesson, module: learningModule, slideId: target.id }), /chapter could not be taught consistently/); assertions++;
      equal(lesson, saved, 'A malformed review cannot partially update the saved course');
    }

    const nativeNow = Date.now, nativeSetTimeout = global.setTimeout;
    let clock = 0;
    const providerTimers = [];
    try {
      Date.now = () => clock;
      global.setTimeout = (callback, ms, ...args) => { providerTimers.push(ms); return nativeSetTimeout(callback, ms, ...args); };
      global.fetch = async (_url, init) => {
        const body = JSON.parse(init.body), review = body.output_config.format.schema.required.includes('corrections');
        if (!review) clock = 55_000;
        return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(review ? { corrections: [] } : chapterDraft()) }] });
      };
      await generateLessonDetail({ lesson, module: learningModule, slideId: target.id }, new AbortController().signal);
      equal(providerTimers, [75_000, 20_000], 'Review receives only the time remaining from the shared seventy-five-second chapter deadline');
      clock = 0;
      let deadlineCalls = 0;
      global.fetch = async () => { deadlineCalls++; clock = 75_000; return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(chapterDraft()) }] }); };
      await assert.rejects(generateLessonDetail({ lesson, module: learningModule, slideId: target.id }, new AbortController().signal), /took too long to verify/); assertions++;
      equal(deadlineCalls, 1, 'An exhausted generation budget cannot start another paid review request');
    } finally { Date.now = nativeNow; global.setTimeout = nativeSetTimeout; }

    const reviewController = new AbortController();
    let reviewStarted;
    const waitingForReview = new Promise(resolve => { reviewStarted = resolve; });
    let cancellationCalls = 0;
    global.fetch = async (_url, init) => {
      cancellationCalls++;
      const body = JSON.parse(init.body);
      if (!body.output_config.format.schema.required.includes('corrections'))
        return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(chapterDraft()) }] });
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        reviewStarted();
      });
    };
    const canceledReview = assert.rejects(generateLessonDetail({ lesson, module: learningModule, slideId: target.id }, reviewController.signal), /AI generation is unavailable/);
    await waitingForReview;
    reviewController.abort();
    await canceledReview; assertions++;
    equal(cancellationCalls, 2, 'Canceling during quality review stops the active request without starting another generation');
    equal(lesson, saved, 'A canceled review cannot save unchecked chapter teaching');

    const courseWithOtherTeaching = clone(lesson);
    courseWithOtherTeaching.slides[0].scenes = [{ title: 'Synthetic unrelated expansion', narration: 'DO-NOT-SEND-OTHER-EXPANDED-CHAPTER'.repeat(100), visual: { kind: 'concept', lines: ['Synthetic marker'] } }];
    courseWithOtherTeaching.slides[0].narration = courseWithOtherTeaching.slides[0].scenes[0].narration;
    provider(chapterDraft());
    await generateLessonDetail({ lesson: courseWithOtherTeaching, module: learningModule, slideId: target.id });
    check(!calls[0].body.messages[0].content.includes('DO-NOT-SEND-OTHER-EXPANDED-CHAPTER'), 'An expanded neighboring chapter is not resent while teaching another chapter');

    const extraSteps = chapterDraft();
    extraSteps.workedExample.visualKind = 'Code';
    extraSteps.workedExample.steps = Array.from({ length: 10 }, (_, index) => ({ line: `value_${index} = ${index}`, narration: `For this Bellman example, step ${index} assigns the stated value before checking the next intermediate result.` }));
    provider(extraSteps);
    const packed = (await generateLessonDetail({ lesson, module: learningModule, slideId: target.id })).slide.scenes.find(scene => scene.role === 'worked-example');
    equal(packed.visual.lines.length, 8, 'Additional short code lines are packed into supported display steps');
    equal(packed.visual.lines.join('\n'), extraSteps.workedExample.steps.map(step => step.line).join('\n'), 'Packing preserves every code line, its syntax, and its order');
    equal(packed.lineNarrations.join(' '), extraSteps.workedExample.steps.map(step => step.narration).join(' '), 'Packing keeps the corresponding spoken explanations in the same order');
    equal(packed.visual.kind, 'code', 'Known presentation enum casing is normalized');

    for (const mutate of [
      draft => { delete draft.guidedPractice; },
      draft => { draft.mechanism.steps[0].narration = ''; },
      draft => { draft.workedExample.visualKind = 'html'; },
      draft => { draft.independentPractice.steps[0].untrustedExtra = true; },
      draft => { draft.foundation.steps = 'unreadable'; },
      draft => { draft.foundation.steps = Array(3).fill({ line: 'Bellman value', narration: 'x'.repeat(1800) }); },
    ]) {
      const malformed = chapterDraft(); mutate(malformed); provider(malformed);
      await assert.rejects(generateLessonDetail({ lesson, module: learningModule, slideId: target.id }), /chapter could not be taught consistently/); assertions++;
    }
    provider(chapterDraft());
    await assert.rejects(generateLessonDetail({ lesson, module: learningModule, slideId: 'invented-chapter' }), /belongs to this lesson/); assertions++;
    equal(calls.length, 0, 'An invented chapter never creates a provider charge');
    const missingChapter = outlineDraft(); delete missingChapter.chapters.chapter8; provider(missingChapter);
    await assert.rejects(generateLessonResponse({ module: learningModule })); assertions++;

    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = async () => { throw new Error('Unconfigured teaching must not call a provider'); };
    await assert.rejects(generateLessonDetail({ lesson, module: learningModule, slideId: target.id }), /AI-generated course needs a configured server API key/); assertions++;
    equal(lesson, saved, 'A missing key cannot relabel or replace a saved AI-authored course');
    const catalogModule = { ...learningModule, id: 'data-science-01' };
    const catalogLesson = { ...lesson, moduleId: catalogModule.id };
    await assert.rejects(generateLessonDetail({ lesson: catalogLesson, module: catalogModule, slideId: target.id }), /AI-generated course needs a configured server API key/); assertions++;
    delete catalogLesson.teachingVersion;
    const fallback = await generateLessonDetail({ lesson: catalogLesson, module: catalogModule, slideId: target.id });
    equal(fallback.mode, 'mock', 'Faithful unconfigured playback is clearly distinguished from authored teaching');
    equal(fallback.slide.narration, target.narration, 'Unconfigured mode does not fabricate a longer course explanation');
    check(!fallback.slide.teachingVersion, 'A faithful short fallback is not mislabeled as substantial teaching');
    console.log(`PASS ${assertions} course teaching assertions: ordered topic curriculum, substantial role coverage, exact voice/visual alignment, target patches, preserved course state, and bounded safe failures.`);
    console.log('Provider transport is stubbed; no credentials or live API calls were used.');
  } finally {
    global.fetch = original.fetch;
    if (original.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = original.key;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
