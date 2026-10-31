# API contracts

[`lib/types.ts`](../lib/types.ts) is the single source of truth for all domain objects and request/response schemas. Consumers import its interfaces instead of declaring parallel types. Pure runtime assertions and request parsers live in [`lib/validators.ts`](../lib/validators.ts), which can also validate restored browser state. [`lib/validation.ts`](../lib/validation.ts) adds bounded JSON reading and HTTP error responses for route handlers.

All endpoints accept JSON POST requests and return JSON. Success responses have HTTP status `200` and `mode: "mock"`. They are stateless: the browser supplies the relevant profile, module, or lesson context on each request.

## Endpoints

| Endpoint           | Request type                                                                     | Response type                                              | Behavior                                                                             |
| ------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /api/plan`   | `PlanRequest` → `{ profile: LearnerProfile }`                                    | `PlanResponse` → `{ plan: StudyPlan, mode: "mock" }`       | Select a fixed track catalog and tailor its summary and pacing using profile fields. |
| `POST /api/lesson` | `LessonRequest` → `{ module: Module }`                                           | `LessonResponse` → `{ lesson: Lesson, mode: "mock" }`      | Return canonical slides and a quiz for a supported catalog module.                   |
| `POST /api/chat`   | `ChatRequest` → `{ lesson: Lesson, question: string, messages: TutorMessage[] }` | `ChatResponse` → `{ message: TutorMessage, mode: "mock" }` | Return a deterministic response grounded in the supplied slide context.              |

### Create a plan

```sh
curl http://localhost:3000/api/plan \
  -H 'Content-Type: application/json' \
  -d '{
    "profile": {
      "id": "learner-demo",
      "name": "Alex",
      "background": "Economics graduate with introductory statistics",
      "experience": "Two years analyzing operations reports",
      "skills": ["Excel", "SQL"],
      "goals": "Use Python and data analysis to make better decisions",
      "availableStudyTime": 5,
      "track": "data-science"
    }
  }'
```

`track` is one of `data-science`, `web-development`, or `product-design`. `availableStudyTime` is hours per week, from 1 to 40. The response plan relates to the profile through `profileId`; its modules contain prerequisite module IDs, resource links, topics, status, and estimated duration in **minutes**. `weeklyStudyHours` preserves the profile's weekly study budget. `generatedAt` is an ISO timestamp.

Catalog module IDs run from `<track>-01` through `<track>-06`. Module prerequisites refer to other modules in the same plan. The first module is available; later modules begin locked and the browser updates their statuses as quizzes are passed. Regenerating a plan creates fresh curriculum progress.

### Create a lesson

Pass a complete module object from `plan.modules` as `{ "module": module }`. The module's ID, title, and topics must match the supported catalog. The server validates the nested resource objects and prerequisites, then generates content from the canonical catalog rather than accepting arbitrary lesson instructions.

`lesson.moduleId` matches the submitted module's ID. Slides have IDs, titles, bullets, and narration text. Quiz questions have IDs, answer options, a zero-based `correctAnswer` index, and an explanation. Correct answers are client-visible in Phase 1; do not use this contract for secure examinations.

### Ask the tutor

Pass `{ lesson, question, messages: [] }` using a complete lesson from `/api/lesson`. `messages` contains bounded prior messages with an ID, `user` or `assistant` role, and content. The current question goes in `question`; the response is one assistant `TutorMessage`.

The mock tutor uses the supplied slides, accepts validated lesson context, and does not store conversation history. History is part of the future integration contract; the current deterministic response does not reproduce full conversational reasoning. There are no external model calls.

## Domain relationships

| Type               | Relationship and units                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `LearnerProfile`   | Own ID; background, experience, skills, goal, track, and weekly study hours.                |
| `StudyPlan`        | Own ID; `profileId`; ordered modules; track and weekly budget.                              |
| `Module`           | Own ID; prerequisite module IDs; resources; duration in minutes; progress status.           |
| `LearningResource` | Own ID; title, provider, URL, and `article`, `course`, `video`, or `documentation` type.    |
| `Lesson`           | Own ID; parent `moduleId`; slides and quiz questions.                                       |
| `Slide`            | Own ID; title, bullet points, and full narration text.                                      |
| `QuizQuestion`     | Own ID; options and a zero-based correct answer index.                                      |
| `QuizResult`       | `lessonId` and `moduleId`; percentage score, counts, pass status, and completion timestamp. |
| `TutorMessage`     | Own ID; `user` or `assistant` role; text content.                                           |

Module status is one of `not-started`, `in-progress`, `completed`, or `locked`. Quiz results are calculated in the browser; a score of at least 70% passes. No quiz submission endpoint exists in Phase 1.

## Errors and payload limits

All errors use the shared `ApiError` envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A human-readable explanation"
  }
}
```

| HTTP status | Error code          | Meaning                                                                        |
| ----------- | ------------------- | ------------------------------------------------------------------------------ |
| `400`       | `INVALID_JSON`      | Empty or malformed JSON body.                                                  |
| `400`       | `VALIDATION_ERROR`  | Missing/invalid fields, invalid nested objects, or unsupported catalog module. |
| `413`       | `PAYLOAD_TOO_LARGE` | Request exceeds 64 KiB of UTF-8 body bytes.                                    |
| `500`       | `INTERNAL_ERROR`    | Unexpected server failure; private implementation details are not exposed.     |

The parser bounds streamed bodies as well as requests with `Content-Length`. Text, arrays, numeric values, URLs, and nested lesson/quiz objects are validated at runtime; TypeScript alone does not validate network input. Clients should display the server's message and permit retry. No API key is required.

Important field limits are listed below. Required nonempty text rejects whitespace-only values; `experience` is a required string that may be blank. IDs are at most 100 characters.

| Object        | Limits                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile       | Name ≤100 characters; background and goals are nonempty and ≤2,000 each; experience may be blank and is ≤2,000; 0–30 skills of ≤100 characters each; finite study hours from 1 to 40. |
| Module        | Title ≤200 characters; description ≤2,000; 0–20 prerequisite IDs; 0–20 resources; 1–20 topics of ≤200 characters; finite duration from 1 to 10,000 minutes.                           |
| Resource      | Title ≤200 characters; provider ≤100; valid HTTPS URL ≤2,000; known resource type.                                                                                                    |
| Lesson        | Title ≤200 characters; 1–30 slides and 1–20 quiz questions, with unique IDs within each collection.                                                                                   |
| Slide         | Title ≤200 characters; 1–10 bullets of ≤2,000 characters; narration ≤5,000 characters.                                                                                                |
| Quiz question | Question and explanation ≤2,000 characters each; 2–6 options of ≤2,000 characters; integer correct-answer index within the options.                                                   |
| Chat          | Question ≤2,000 characters; 0–20 messages, each with ≤4,000 characters of content and a known role.                                                                                   |

Run `npm run test:smoke` against a running application to exercise the success flow and error contracts for all three tracks.
