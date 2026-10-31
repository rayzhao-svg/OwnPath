import type {
  ApiError,
  ChatRequest,
  LearnerProfile,
  Lesson,
  LessonRequest,
  LearningResource,
  Module,
  PlanRequest,
  QuizQuestion,
  QuizResult,
  Slide,
  TeachingScene,
  StudyPlan,
  TutorMessage,
} from "@/lib/types";

type ErrorCode = ApiError["error"]["code"];

export class ApiFailure extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function fail(message: string): never {
  throw new ApiFailure("VALIDATION_ERROR", message);
}
function record(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${path} must be an object.`);
}
function textValue(
  value: unknown,
  path: string,
  max = 2000,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > max
  )
    fail(`${path} must contain 1–${max} characters.`);
}
function enumValue<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): asserts value is T {
  if (typeof value !== "string" || !choices.includes(value as T))
    fail(`${path} must be one of: ${choices.join(", ")}.`);
}
function list(
  value: unknown,
  path: string,
  max: number,
  min = 0,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail(`${path} must be an array with ${min}–${max} entries.`);
}
function textList(
  value: unknown,
  path: string,
  maxEntries: number,
  maxText = 200,
  min = 0,
): asserts value is string[] {
  list(value, path, maxEntries, min);
  value.forEach((item, i) => textValue(item, `${path}[${i}]`, maxText));
}
function finiteNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(`${path} must be a number from ${min} to ${max}.`);
}

export function assertProfile(value: unknown): asserts value is LearnerProfile {
  record(value, "profile");
  textValue(value.id, "profile.id", 100);
  textValue(value.name, "profile.name", 100);
  textValue(value.background, "profile.background");
  if (typeof value.experience !== "string" || value.experience.length > 2000)
    fail(
      "profile.experience must be a string with at most 2000 characters; it may be empty.",
    );
  textValue(value.goals, "profile.goals");
  textList(value.skills, "profile.skills", 30, 100);
  finiteNumber(value.availableStudyTime, "profile.availableStudyTime", 1, 40);
  enumValue(
    value.track,
    ["data-science", "web-development", "product-design"],
    "profile.track",
  );
}

function assertResource(
  value: unknown,
  path: string,
): asserts value is LearningResource {
  record(value, path);
  textValue(value.id, `${path}.id`, 100);
  textValue(value.title, `${path}.title`, 200);
  textValue(value.provider, `${path}.provider`, 100);
  textValue(value.url, `${path}.url`, 2000);
  try {
    if (new URL(value.url).protocol !== "https:")
      fail(`${path}.url must use HTTPS.`);
  } catch {
    fail(`${path}.url must be a valid HTTPS URL.`);
  }
  enumValue(
    value.type,
    ["article", "course", "video", "documentation"],
    `${path}.type`,
  );
}

export function assertModule(value: unknown): asserts value is Module {
  record(value, "module");
  textValue(value.id, "module.id", 100);
  textValue(value.title, "module.title", 200);
  textValue(value.description, "module.description", 2000);
  textList(value.prerequisites, "module.prerequisites", 20, 100);
  list(value.resources, "module.resources", 20);
  value.resources.forEach((item, index) =>
    assertResource(item, `module.resources[${index}]`),
  );
  finiteNumber(value.estimatedDuration, "module.estimatedDuration", 1, 10000);
  enumValue(
    value.status,
    ["not-started", "in-progress", "completed", "locked"],
    "module.status",
  );
  textList(value.topics, "module.topics", 20, 200, 1);
}

/** Shared by generated responses, client ingestion, and version-1 storage. */
export function assertStudyPlan(value: unknown): asserts value is StudyPlan {
  record(value, "plan");
  textValue(value.id, "plan.id", 100);
  textValue(value.profileId, "plan.profileId", 100);
  textValue(value.title, "plan.title", 200);
  // Existing mock summaries can contain all three bounded profile text fields.
  textValue(value.summary, "plan.summary", 8000);
  enumValue(value.track, ["data-science", "web-development", "product-design"], "plan.track");
  finiteNumber(value.weeklyStudyHours, "plan.weeklyStudyHours", 1, 40);
  textValue(value.generatedAt, "plan.generatedAt", 100);
  if (!Number.isFinite(Date.parse(value.generatedAt)))
    fail("plan.generatedAt must be a valid timestamp.");
  // Keep older persisted curricula compatible; Claude separately requires 4–6.
  list(value.modules, "plan.modules", 50, 1);
  value.modules.forEach(assertModule);
  const modules = value.modules as Module[];
  const byId = new Map(modules.map((item) => [item.id, item]));
  if (byId.size !== modules.length) fail("plan.modules must have unique IDs.");
  if (!modules.some((item) => item.status !== "locked"))
    fail("plan must have at least one available or completed module.");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) fail("plan prerequisites must not contain cycles.");
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) fail("plan prerequisites must reference modules in this plan.");
    if (new Set(item.prerequisites).size !== item.prerequisites.length)
      fail("module prerequisites must not repeat IDs.");
    visiting.add(id);
    item.prerequisites.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  modules.forEach((item) => visit(item.id));
}

export function assertTeachingScene(value: unknown, path = "scene"): asserts value is TeachingScene {
  record(value, path);
  if (Object.keys(value).length !== 3 || !["title", "narration", "visual"].every((key) => Object.hasOwn(value, key)))
    fail(`${path} must contain only title, narration, and visual.`);
  textValue(value.title, `${path}.title`, 80);
  textValue(value.narration, `${path}.narration`, 700);
  record(value.visual, `${path}.visual`);
  if (Object.keys(value.visual).length !== 2 || !Object.hasOwn(value.visual, "kind") || !Object.hasOwn(value.visual, "lines"))
    fail(`${path}.visual must contain only kind and lines.`);
  enumValue(value.visual.kind, ["concept", "code", "calculation", "comparison"], `${path}.visual.kind`);
  textList(value.visual.lines, `${path}.visual.lines`, 5, 250, 1);
}

function assertSlide(value: unknown, path: string): asserts value is Slide {
  record(value, path);
  textValue(value.id, `${path}.id`, 100);
  textValue(value.title, `${path}.title`, 200);
  textList(value.bullets, `${path}.bullets`, 10, 2000, 1);
  textValue(value.narration, `${path}.narration`, 5000);
  if (value.scenes !== undefined) {
    list(value.scenes, `${path}.scenes`, 10, 1);
    value.scenes.forEach((scene, index) => assertTeachingScene(scene, `${path}.scenes[${index}]`));
    if ((value.scenes as TeachingScene[]).map((scene) => scene.narration).join(" ") !== value.narration)
      fail(`${path}.narration must match the ordered teaching scenes.`);
  }
}
function assertQuestion(
  value: unknown,
  path: string,
): asserts value is QuizQuestion {
  record(value, path);
  textValue(value.id, `${path}.id`, 100);
  textValue(value.question, `${path}.question`, 2000);
  textList(value.options, `${path}.options`, 6, 2000, 2);
  finiteNumber(
    value.correctAnswer,
    `${path}.correctAnswer`,
    0,
    value.options.length - 1,
  );
  if (!Number.isInteger(value.correctAnswer))
    fail(`${path}.correctAnswer must be an integer.`);
  textValue(value.explanation, `${path}.explanation`, 2000);
}
export function assertLesson(value: unknown): asserts value is Lesson {
  record(value, "lesson");
  textValue(value.id, "lesson.id", 100);
  textValue(value.moduleId, "lesson.moduleId", 100);
  textValue(value.title, "lesson.title", 200);
  list(value.slides, "lesson.slides", 30, 1);
  value.slides.forEach((item, index) =>
    assertSlide(item, `lesson.slides[${index}]`),
  );
  list(value.quiz, "lesson.quiz", 20, 1);
  value.quiz.forEach((item, index) =>
    assertQuestion(item, `lesson.quiz[${index}]`),
  );
  const slides = value.slides as Slide[];
  const questions = value.quiz as QuizQuestion[];
  if (new Set(slides.map((slide) => slide.id)).size !== slides.length)
    fail("lesson.slides must have unique IDs.");
  if (
    new Set(questions.map((question) => question.id)).size !== questions.length
  )
    fail("lesson.quiz must have unique IDs.");
}
function assertMessage(
  value: unknown,
  path: string,
): asserts value is TutorMessage {
  record(value, path);
  textValue(value.id, `${path}.id`, 100);
  enumValue(value.role, ["user", "assistant"], `${path}.role`);
  textValue(value.content, `${path}.content`, 4000);
}

export function parsePlanRequest(value: unknown): PlanRequest {
  record(value, "body");
  assertProfile(value.profile);
  return { profile: value.profile };
}
export function parseLessonRequest(value: unknown): LessonRequest {
  record(value, "body");
  assertModule(value.module);
  return { module: value.module };
}
export function parseChatRequest(value: unknown): ChatRequest {
  record(value, "body");
  assertLesson(value.lesson);
  textValue(value.question, "question", 2000);
  list(value.messages, "messages", 20);
  value.messages.forEach((item, index) =>
    assertMessage(item, `messages[${index}]`),
  );
  return {
    lesson: value.lesson,
    question: value.question.trim(),
    messages: value.messages as TutorMessage[],
  };
}

/** Validate persisted local quiz data, including the derived score and pass state. */
export function assertQuizResult(value: unknown): asserts value is QuizResult {
  record(value, "quizResult");
  textValue(value.lessonId, "quizResult.lessonId", 100);
  textValue(value.moduleId, "quizResult.moduleId", 100);
  finiteNumber(value.totalQuestions, "quizResult.totalQuestions", 1, 20);
  finiteNumber(
    value.correctAnswers,
    "quizResult.correctAnswers",
    0,
    value.totalQuestions,
  );
  if (
    !Number.isInteger(value.totalQuestions) ||
    !Number.isInteger(value.correctAnswers)
  )
    fail("Quiz counts must be integers.");
  finiteNumber(value.score, "quizResult.score", 0, 100);
  const expectedScore = Math.round(
    (value.correctAnswers / value.totalQuestions) * 100,
  );
  if (value.score !== expectedScore)
    fail("quizResult.score must match correctAnswers and totalQuestions.");
  if (typeof value.passed !== "boolean" || value.passed !== value.score >= 70)
    fail("quizResult.passed must match the 70% passing threshold.");
  textValue(value.completedAt, "quizResult.completedAt", 100);
  if (!Number.isFinite(Date.parse(value.completedAt)))
    fail("quizResult.completedAt must be a valid timestamp.");
  if (value.answers !== undefined) {
    record(value.answers, "quizResult.answers");
    if (Object.keys(value.answers).length !== value.totalQuestions)
      fail("quizResult.answers must contain one answer for every question.");
    for (const [id, answer] of Object.entries(value.answers)) {
      textValue(id, "quizResult.answers question ID", 100);
      finiteNumber(answer, `quizResult.answers[${id}]`, 0, 5);
      if (!Number.isInteger(answer)) fail("Quiz answers must be integer choice indices.");
    }
  }
  if (value.missedQuestionIds !== undefined) {
    textList(value.missedQuestionIds, "quizResult.missedQuestionIds", 20, 100);
    if (
      new Set(value.missedQuestionIds).size !== value.missedQuestionIds.length ||
      value.missedQuestionIds.length !== value.totalQuestions - value.correctAnswers
    ) fail("Missed question IDs must be unique and match the incorrect answer count.");
    if (value.answers && value.missedQuestionIds.some((id) => !Object.hasOwn(value.answers as object, id)))
      fail("Missed question IDs must belong to the answered questions.");
  }
  if (value.questions !== undefined) {
    list(value.questions, "quizResult.questions", 20, 1);
    value.questions.forEach((question, index) => assertQuestion(question, `quizResult.questions[${index}]`));
    const questions = value.questions as QuizQuestion[];
    if (questions.length !== value.totalQuestions || new Set(questions.map((question) => question.id)).size !== questions.length)
      fail("Quiz question snapshots must contain exactly the scored questions with unique IDs.");
    if (value.answers !== undefined) {
      const answers = value.answers as Record<string, number>;
      if (questions.some((question) => !Object.hasOwn(answers, question.id) || answers[question.id] >= question.options.length))
        fail("Quiz answers must match the saved question snapshot.");
      const missed = questions.filter((question) => answers[question.id] !== question.correctAnswer);
      if (questions.length - missed.length !== value.correctAnswers)
        fail("Quiz question snapshots must agree with the recorded score.");
      if (value.missedQuestionIds && missed.some((question) => !(value.missedQuestionIds as string[]).includes(question.id)))
        fail("Missed questions must agree with the saved question snapshot.");
    }
  }
}
