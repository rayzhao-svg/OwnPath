import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const tracks = ["data-science", "web-development", "product-design"];
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

async function post(path, body) {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  check(
    response.headers.get("content-type")?.includes("application/json"),
    `${path} returns JSON`,
  );
  return { response, data: await response.json() };
}

async function expectError(path, body, status, code) {
  const { response, data } = await post(path, body);
  assert.equal(response.status, status, `${path} status for ${code}`);
  assert.equal(data.error?.code, code, `${path} code`);
  check(
    typeof data.error?.message === "string" && data.error.message.length > 0,
    `${path} error message`,
  );
}

function verifyLesson(lesson, learningModule) {
  assert.equal(lesson.moduleId, learningModule.id);
  assert.equal(lesson.title, learningModule.title);
  check(
    typeof lesson.id === "string" && lesson.id.length > 0,
    "Lesson has an ID",
  );
  check(
    Array.isArray(lesson.slides) && lesson.slides.length > 0,
    "Lesson has slides",
  );
  check(
    new Set(lesson.slides.map((slide) => slide.id)).size ===
      lesson.slides.length,
    "Slide IDs are unique",
  );
  for (const slide of lesson.slides) {
    check(
      typeof slide.title === "string" && slide.title.length > 0,
      "Slide title is present",
    );
    check(
      Array.isArray(slide.bullets) && slide.bullets.length > 0,
      "Slide bullets are present",
    );
    check(
      typeof slide.narration === "string" && slide.narration.length > 0,
      "Slide narration is present",
    );
  }
  check(
    Array.isArray(lesson.quiz) && lesson.quiz.length > 0,
    "Lesson has a quiz",
  );
  check(
    new Set(lesson.quiz.map((question) => question.id)).size ===
      lesson.quiz.length,
    "Quiz question IDs are unique",
  );
  for (const question of lesson.quiz) {
    check(
      typeof question.question === "string" && question.question.length > 0,
      "Quiz question text is present",
    );
    check(
      Array.isArray(question.options) && question.options.length >= 2,
      "Quiz has answer choices",
    );
    check(
      Number.isInteger(question.correctAnswer) &&
        question.correctAnswer >= 0 &&
        question.correctAnswer < question.options.length,
      "Correct answer is a valid option index",
    );
    check(
      typeof question.explanation === "string" &&
        question.explanation.length > 0,
      "Quiz explanation is present",
    );
  }
}

async function main() {
  for (const path of [
    "/",
    "/onboarding",
    "/dashboard",
    "/learn/data-science-01",
  ]) {
    const response = await fetch(new URL(path, base), {
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(response.status, 200, `${path} serves successfully`);
    check(
      (await response.text()).includes("OwnPath"),
      `${path} renders the application`,
    );
  }

  for (const track of tracks) {
    const profile = {
      id: `smoke-${track}`,
      name: "Alex",
      background: "Economics graduate with introductory statistics",
      experience: "Two years analyzing operations reports",
      skills: ["Excel", "SQL"],
      goals: "Build practical skills and complete a portfolio project",
      availableStudyTime: 5,
      track,
    };
    const planned = await post("/api/plan", { profile });
    assert.equal(planned.response.status, 200);
    assert.equal(planned.data.mode, "mock");
    const { plan } = planned.data;
    assert.equal(plan.profileId, profile.id);
    assert.equal(plan.track, track);
    assert.equal(plan.weeklyStudyHours, profile.availableStudyTime);
    check(typeof plan.id === "string" && plan.id.length > 0, "Plan has an ID");
    check(
      typeof plan.summary === "string" && plan.summary.length > 0,
      "Plan has a summary",
    );
    check(
      !Number.isNaN(Date.parse(plan.generatedAt)),
      "Plan has an ISO timestamp",
    );
    check(
      Array.isArray(plan.modules) && plan.modules.length > 0,
      `${track} has modules`,
    );
    const seen = new Set();
    for (const learningModule of plan.modules) {
      check(
        typeof learningModule.id === "string" && !seen.has(learningModule.id),
        "Module IDs are unique",
      );
      check(
        learningModule.prerequisites.every((id) => seen.has(id)),
        "Prerequisites precede their modules",
      );
      check(
        learningModule.estimatedDuration > 0,
        "Module duration is positive",
      );
      check(
        ["not-started", "in-progress", "completed", "locked"].includes(
          learningModule.status,
        ),
        "Module status is valid",
      );
      check(
        Array.isArray(learningModule.topics) &&
          learningModule.topics.length > 0,
        "Module has topics",
      );
      check(
        Array.isArray(learningModule.resources) &&
          learningModule.resources.length > 0,
        "Module has learning resources",
      );
      for (const resource of learningModule.resources) {
        check(
          new URL(resource.url).protocol === "https:",
          "Resources use HTTPS",
        );
        check(
          ["article", "course", "video", "documentation"].includes(
            resource.type,
          ),
          "Resource type is valid",
        );
      }
      seen.add(learningModule.id);
    }
    check(plan.modules[0].status !== "locked", "The first module is available");

    const lessons = [];
    for (const learningModule of plan.modules) {
      const generated = await post("/api/lesson", { module: learningModule });
      assert.equal(
        generated.response.status,
        200,
        `${learningModule.id} generates a lesson`,
      );
      assert.equal(generated.data.mode, "mock");
      verifyLesson(generated.data.lesson, learningModule);
      lessons.push(generated.data.lesson);
    }
    check(
      new Set(lessons.map((lesson) => lesson.id)).size === lessons.length,
      "Lesson IDs are unique across the plan",
    );
    const lesson = lessons[0];
    const learningModule = plan.modules[0];

    const question = `Can you explain ${lesson.slides[0].title}?`;
    const chatted = await post("/api/chat", { lesson, question, messages: [] });
    assert.equal(chatted.response.status, 200);
    assert.equal(chatted.data.mode, "mock");
    assert.equal(chatted.data.message.role, "assistant");
    check(
      typeof chatted.data.message.id === "string" &&
        chatted.data.message.id.length > 0,
      "Tutor message has an ID",
    );
    check(
      typeof chatted.data.message.content === "string" &&
        chatted.data.message.content.length > 0,
      "Tutor returns text",
    );

    await expectError(
      "/api/plan",
      { profile: { ...profile, availableStudyTime: 0 } },
      400,
      "VALIDATION_ERROR",
    );
    await expectError(
      "/api/lesson",
      {
        module: {
          ...learningModule,
          resources: [
            { ...learningModule.resources[0], url: "javascript:alert(1)" },
          ],
        },
      },
      400,
      "VALIDATION_ERROR",
    );
    await expectError(
      "/api/lesson",
      { module: { ...learningModule, id: "unknown-module" } },
      400,
      "VALIDATION_ERROR",
    );
    await expectError(
      "/api/chat",
      {
        lesson: { ...lesson, quiz: [{ ...lesson.quiz[0], correctAnswer: 99 }] },
        question,
        messages: [],
      },
      400,
      "VALIDATION_ERROR",
    );
    await expectError(
      "/api/chat",
      { lesson, question: " ", messages: [] },
      400,
      "VALIDATION_ERROR",
    );
    const beginner = await post("/api/plan", {
      profile: { ...profile, experience: "", skills: [] },
    });
    assert.equal(
      beginner.response.status,
      200,
      "Learners may start without work experience or existing skills",
    );
    check(
      beginner.data.plan.modules.length > 0,
      "Beginner profile receives a curriculum",
    );
    console.log(
      `✓ ${track}: plan → ${lessons.length} lessons → tutor and nested validation`,
    );
  }

  for (const path of ["/api/plan", "/api/lesson", "/api/chat"]) {
    await expectError(path, "{", 400, "INVALID_JSON");
    await expectError(path, "", 400, "INVALID_JSON");
    await expectError(path, {}, 400, "VALIDATION_ERROR");
    await expectError(
      path,
      JSON.stringify({ padding: "x".repeat(70_000) }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
  }
  console.log(
    `✓ Routes and error contracts passed (${checks} assertions) at ${base}`,
  );
}

main().catch((error) => {
  console.error("Smoke checks failed:", error);
  process.exitCode = 1;
});
