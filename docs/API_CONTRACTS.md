# API contracts

## Account and multi-path persistence

Authentication and saved path endpoints are documented in [ACCOUNTS.md](ACCOUNTS.md). Signed-in learners persist independent version-1 learning states per opaque path record, including multiple paths in the same track category. The workspace preserves the existing active-learning API while syncing full state with owner checks and revision-based saves. Guest libraries use a version-2 envelope and import only after an explicit user action. AI request contracts below remain unchanged.

[`lib/types.ts`](../lib/types.ts) is the single source of truth for all domain objects and request/response schemas. Consumers import its interfaces instead of declaring parallel types. Pure runtime assertions and request parsers live in [`lib/validators.ts`](../lib/validators.ts), which can also validate restored browser state. [`lib/validation.ts`](../lib/validation.ts) adds bounded JSON reading and HTTP error responses for route handlers.

All endpoints accept JSON POST requests and return JSON. Success responses have HTTP status `200` and `mode: "mock" | "claude"`. Phase 3A integrates the Phase 2A curriculum engine and Phase 2B lecture/tutor adapters: all three endpoints use Claude when the server key is configured and retain their existing mock behavior otherwise. The endpoints are stateless: the browser supplies the relevant profile, module, or lesson context on each request.

## Endpoints

| Endpoint           | Request type                                                                     | Response type                                              | Behavior                                                                             |
| ------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /api/plan`   | `PlanRequest` → `{ profile: LearnerProfile }`                                    | `PlanResponse` → `{ plan: StudyPlan, mode: "mock" \| "claude" }` | Generate a personalized curriculum with Claude when configured; otherwise preserve the fixed mock catalog. |
| `POST /api/lesson` | `LessonRequest` → `{ module: Module }`                                           | `LessonResponse` → `{ lesson: Lesson, mode: "mock" \| "claude" }` | Generate a lecture and quiz for the supplied module; use canonical catalog lessons in mock mode. |
| `POST /api/lesson/detail` | `LessonDetailRequest` → `{ lesson, module }` | `LessonResponse` → `{ lesson, mode }` | Expand the lesson into guided teaching scenes while preserving identities and quiz. |
| `POST /api/quiz` | `QuizRefreshRequest` → `{ lesson, previousQuestions, questionCount? }` | `QuizRefreshResponse` → `{ lessonId, moduleId, quiz, mode }` | Generate 5–10 fresh lesson-based questions; defaults to five. |
| `POST /api/chat`   | `ChatRequest` → `{ lesson: Lesson, question: string, messages: TutorMessage[] }` | `ChatResponse` → `{ message: TutorMessage, mode: "mock" \| "claude" }` | Answer with lecture, active-slide, and bounded conversation context; retain the deterministic mock fallback. |

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

Mock catalog module IDs run from `<track>-01` through `<track>-06`. Claude module IDs are fresh `claude-<UUID>-<position>` values and must be treated as opaque IDs. Module prerequisites refer to earlier module IDs in the same plan, preventing cycles. Claude modules without prerequisites start `not-started`; modules with prerequisites start `locked`. The browser updates their statuses as quizzes are passed. Regenerating a plan creates fresh curriculum progress.

The shared `assertStudyPlan` validator checks unique module IDs, valid prerequisite references, no cycles or repeated prerequisites, at least one available/completed module, timestamps, and all nested module/resource contracts. It runs on Claude output, client plan ingestion, and version-1 storage restoration. The client also checks that profile ID, track, and weekly hours match the submitted learner. Restored lesson caches must match the selected module's ID and title; stale cache entries are ignored without changing the curriculum's progress. No browser storage migration is required.

Phase 3B stores optional `planMode`, `lessonModes`, and a local `planGeneration` token alongside the existing version-1 learning state. Modes come from actual API responses, so refreshed curricula and cached lessons remain labeled correctly. Older stores without mode metadata show neutral saved-content labels. Every replacement plan clears lessons, quiz results, and lesson modes and receives a fresh generation token, even when deterministic mock plan IDs repeat. Late requests from older generations cannot restore incompatible caches. Valid saved curricula are displayed in prerequisite order; locked modules name their unmet prerequisites.

### Phase 2A Claude curriculum generation

The server-only adapter is [`lib/claude-plan.ts`](../lib/claude-plan.ts). It calls the [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create) using `claude-sonnet-5-5`, API version `2026-10-21`, and [structured JSON output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Native server-side `fetch` avoids adding dependencies. The key never enters a client bundle, prompt, resource request, or response. The adapter sends only background, experience, skills, goals, track, and study time to Anthropic; learner ID/name remain local.

The curriculum prompt assesses educational background and experience alongside demonstrated skills. It asks Claude to change actual topics, depth, bridging material, and practical deliverables for a specific goal within the selected track. It instructs Claude to state assumptions and narrow goals beyond the available scope. Runtime validation checks the generated structure; semantic personalization and teaching quality still need live review.

Claude returns an internal draft containing title, summary, skipped-material explanation, and **4–6 modules**. Each module contains a title, description, inclusion reason, **2–8 concrete lesson topics**, duration, prerequisite indices, and **1–3 academic resource IDs**. The server validates this draft, then creates the existing `StudyPlan`/`Module` shape:

- Inclusion and prerequisite explanations are appended to each module's `description` under `Why this module:`.
- The assessment and pacing are in `summary`; omission explanations follow `Skipped or condensed material:`. The explanation states why foundations stay when nothing can be skipped.
- Durations are integer **minutes**, from **30 minutes up to the learner's total twelve-week budget per module** (at most **28,800 minutes** for 40 hours/week). Total workload cannot exceed **12 weeks × the profile's weekly hours × 60**. Weekly hours are preserved exactly.
- IDs, timestamps, statuses, prerequisite module IDs, and resource metadata are assembled by the server. No persistence version or domain fields change. Generated modules pass the same runtime module parser used by browser persistence and the lesson request contract.

The academic catalog contains Harvard CS50 (Python, SQL, web programming), MIT OpenCourseWare (data science and interface design), University of Helsinki Full Stack open, and the *Introduction to Statistical Learning* authors' site. Exact URLs and page titles were checked on **2026-10-30**. Claude can select only catalog IDs for the chosen track; it cannot supply URLs or citation metadata. Free-text links and unknown resource IDs are rejected. Catalog URL checks begin in parallel with generation: HTTPS GET, no redirects, HTTP **200**, and HTML/PDF content type. Successful checks are reused for ten minutes; only sources selected in the returned plan must pass. Only catalog URLs are fetched, without learner data or API credentials. A failed check rejects the plan rather than returning an unverified citation. Link reachability does not establish that every generated topic is covered; review resource relevance during live testing. Broad course resources are selected readings, not claims that entire courses fit the module duration.

Generation permits **6,000 output tokens** and a **60-second** provider deadline; the browser permits **75 seconds**, including development route compilation and reading the response. Cold structured-output schemas require extra provider compilation time, so the earlier 21-second cutoff could reject a first attempt before later cached attempts succeeded. Up-front adaptive thinking is suppressed. Each resource check has a **4-second** deadline and overlaps generation. Provider response bodies are bounded to **128 KiB** including streamed bytes. Refusals, truncation, malformed JSON, extra fields, duplicate entries, invalid counts/durations, unknown resources, and invalid prerequisites are rejected. The shared transport coalesces identical concurrent requests and retries at most one explicit transient HTTP failure, respecting a Retry-After of up to two seconds. Network/read timeouts, malformed completions, and authentication failures are never automatically replayed. Completed learner responses are not cached. Real provider latency varies.

Missing, blank, or literal `YOUR_API_KEY_HERE` credentials deliberately return the unchanged mock behavior with `mode: "mock"`. Any other configured key attempts Claude generation. Authentication, quota/rate-limit, network, source-check, or invalid-output failures return HTTP `500` with the existing `INTERNAL_ERROR` envelope and a safe retry/configuration message. They do not silently switch to mocks. Provider errors, response text, learner fields, and keys are not logged.

**Integrated flow:** a complete module returned by `/api/plan` can be passed directly to `/api/lesson`, and that lesson can be passed directly to `/api/chat`. Claude lesson generation accepts validated modules without a hardcoded catalog-ID requirement. Catalog identity checks remain only in the unconfigured mock fallback. Removing the key does not turn a previously generated live curriculum into a catalog curriculum; restore the key or create a new mock plan to continue those saved modules.

### Enable and verify live generation

1. Open the repository-root [`.env.local`](../.env.local), **line 1**, and replace only `YOUR_API_KEY_HERE` in `ANTHROPIC_API_KEY=YOUR_API_KEY_HERE` with your real Anthropic API key. Never use a `NEXT_PUBLIC_` variable or put the key in a curl command. `.env.local` is ignored by the existing `.env.*` rule; [`.env.example`](../.env.example) contains only the dummy placeholder.
2. Stop the OwnPath server with **Ctrl+C**, then run `npm run dev`. If port 3000 is occupied, use `npm run dev -- --port 3001`; use the port printed by Next.js. Restart is needed after changing the key. An exported shell environment variable takes precedence over `.env.local`; remove any stale exported `ANTHROPIC_API_KEY` without printing it.
3. Submit the example `/api/plan` request above against that port, or complete onboarding and inspect the browser Network response for `/api/plan`. A successful live response has HTTP `200`, **`mode: "claude"`**, **4–6 modules**, `claude-` module IDs, and the inclusion/omission explanations. A `"mock"` response means credentials remain unconfigured. HTTP `500` means the configured generation failed; check key validity, API access/credits, network access, and resource availability without sharing your key.
4. Repeat with the **same goal and track** for a novice (no experience/skills) and an experienced learner (relevant education, Python/SQL/statistics, prior projects), varying weekly hours. Compare actual topics, difficulty, prerequisite order, omissions, resource relevance, and the twelve-week workload limit. Open an available module, verify a Claude lesson and current-slide tutor answer, complete its quiz, and reload the dashboard to check progress and prerequisite unlocking.

No live API test is considered verified solely because stubbed provider tests pass. Run the existing all-endpoint smoke suite against an isolated server with the dummy key; it expects mock curricula. Do not overwrite a configured local key just to run mock tests.

### Create a lesson

Pass a complete module object from `plan.modules` as `{ "module": module }`. The server validates the module, including nested resource objects, prerequisites, and topics. In Claude mode the adapter teaches the supplied title, description, and topics, treating them as untrusted educational context rather than instructions. It does not depend on catalog IDs. In mock mode the module's ID, title, and topics must match the existing catalog.

`lesson.moduleId` and `lesson.title` match the submitted module. New Claude lessons are ordered eight-chapter course outlines (`teachingVersion: 2`), with a specific learning objective, stable overview, and topic bullets per chapter, plus three initial quiz questions. IDs are server-generated. The outline progresses through prerequisites, mechanisms, worked applications, evaluation, and a capstone appropriate to the module. Detailed teaching is requested per chapter rather than compressing the entire course into four orientation slides. Outline generation permits 7,000 output tokens and uses the shared 60-second provider/75-second client deadlines.

Slides have IDs, titles, bullets, and narration text. Quiz questions have IDs, answer options, a zero-based `correctAnswer` index, and an explanation. Correct answers are client-visible in both modes to support the existing local grading flow; do not use this contract for secure examinations.

### Ask the tutor

Pass `{ lesson, question, messages: [] }` using a complete lesson from `/api/lesson`. `messages` contains bounded prior messages with an ID, `user` or `assistant` role, and content. The current question goes in `question`; the response is one assistant `TutorMessage`.

The current-slide context uses an optional hidden prefix in `question`: `[OwnPath slide: <slideId>]\n<user question>`. The server resolves that ID against `lesson.slides`, rejects unknown IDs, and strips the prefix before teaching. Plain questions remain supported. No extra `ChatRequest` field is required. The UI displays only the learner's question, and keeps the prefix in API history so earlier turns retain their slide context after navigation.

Claude receives the supplied slides, resolved current slide, current question, and up to **20 prior messages** within a **12,000-character** history budget. The client also bounds the UTF-8 request body below **60 KiB**, evicting oldest turns when needed. Tutor answers are bounded to **3,500 characters**, **1,400 output tokens**, and a **60-second** provider deadline and **75-second** client deadline. The UI pauses narration on tutor interaction and allows explicit resume; slide navigation stops narration. Conversation history stays in the mounted lesson interface and resets on reload. The deterministic mock tutor remains available without a configured key and does not provide live conversational reasoning.

### Detailed teaching scenes

`POST /api/lesson/detail` accepts `{ lesson, module, slideId }` for a single chapter and returns `{ lessonId, moduleId, slide, mode }`. The request contains a bounded course outline; previously expanded chapters are not uploaded again. Each generated chapter has seven substantive sections: core concept, mechanism/reasoning, fully worked example, misconception, guided practice, independent practice, and synthesis. Mathematical chapters define notation and assumptions, derive intermediate steps, and show calculations; programming chapters explain executable examples and intermediate state. The target is roughly 120–220 words per section, allowing additional explanation when needed. A separate bounded review checks arithmetic, code, visual/spoken consistency, and logical claims before a chapter receives `qualityVersion: 1`. The complete generation/review operation shares a 75-second deadline; the browser permits 90 seconds.

The browser upgrades the active saved chapter first, then prepares at most one chapter ahead. Existing short lessons keep their IDs, chapter membership, assessments, attempts, and progress while receiving fuller teaching. A chapter patch updates only that chapter; concurrent quiz changes and other chapters survive. Late/canceled responses cannot overwrite another course or chapter. Missing credentials on an AI course produce an actionable error rather than changing its mode to mock. Older whole-lesson detail requests without `slideId` retain the legacy response for compatibility.

The player creates runtime frames with an explicit visual-line index. Authored `lineNarrations` correspond one-to-one to `visual.lines`; the full scene narration is their exact ordered concatenation. Long line explanations split into audio clips while retaining the same highlight. Legacy text is partitioned in order without invented or duplicated words. The player stops at a course chapter boundary; selecting the next chapter loads its complete teaching. Preparing a different chapter does not interrupt current audio.

### Fresh quiz questions

`POST /api/quiz` accepts `QuizRefreshRequest`: `{ lesson, previousQuestions, questionCount? }`, where `questionCount` is an integer from 5 to 10 (default 5) and `previousQuestions` contains up to 60 earlier question stems (at most 2,000 characters each). It returns `QuizRefreshResponse`: `{ lessonId, moduleId, quiz, mode }`. The quiz contains exactly the requested number of new questions with fresh IDs, four distinct options each, an answer index, and an explanation. Questions must be grounded in the supplied slides and must not match current or excluded question stems after normalization. Quiz generation has a 60-second provider deadline and a 75-second client deadline. An explicit quiz request cancels optional background scene expansion, starts immediately, and resumes expansion against the latest saved questions afterward. The client bounds the request below 60 KiB by trimming older exclusions while retaining the current quiz in the lesson. Responses reserve space beneath the shared 64 KiB request limit for subsequent attempt snapshots and reviews. No-store responses and normal body/error limits apply. Configured Claude generation failures are retryable; unconfigured mode uses a finite lesson-based bank and reports exhaustion instead of recycling the same questions.

The assessment selector offers 5–10 questions and defaults to five for older saved quizzes. Changing the selection preserves current answers until the learner generates a replacement. Older three-question sets remain available to historical reviews but cannot be submitted as a new assessment. The passing threshold remains 70%.

New `QuizResult` records include a `questions` snapshot. Historical scoring and targeted reviews use that snapshot rather than the latest active quiz. `replaceQuiz` preserves best/latest results, history, saved reviews, and completed modules while migrating compatible legacy attempts to snapshots. New submissions referring to a superseded question set are rejected. Existing records without snapshots remain compatible.

### Amanda narration

`GET /api/narration` returns `NarrationStatus`: `{ available, voice: "Amanda Multilingual", voiceId: "en-US-AmandaMultilingualNeural", reason?, message? }`. Availability verifies access to Azure's regional voice catalog and the presence of Amanda, using a five-second deadline without sending learner text. Checks share in-flight work and cache success for one minute or failure for five seconds. Missing credentials return immediately. Safe failure reasons distinguish `not-configured`, `authentication`, `voice-unavailable`, and `service-unavailable`; credentials and provider details are never returned. A successful voice-catalog check does not guarantee subsequent synthesis availability.

`POST /api/narration` accepts `NarrationRequest`: `{ "text": "Current slide narration" }`, with 1–5,000 characters and the shared 64 KiB body limit. It returns MP3 bytes with `Content-Type: audio/mpeg`. Only same-origin JSON requests are accepted. The server fixes the voice to Amanda, escapes untrusted text as SSML, and uses `AZURE_SPEECH_KEY` plus its matching `AZURE_SPEECH_REGION`. Responses use `Cache-Control: no-store`. A bounded, ten-minute server memory cache reduces repeat synthesis; audio is not saved to disk.

Failures use the existing JSON error envelope: 400 invalid text/JSON, 403 cross-origin requests, 413 oversized body, 415 unsupported content type, 429 provider throttling, 499 canceled request, 502 synthesis failure, 503 missing configuration, or 504 timeout. Provider details and credentials are withheld. The 20-second synthesis deadline includes reading the audio response; browser status and audio requests have eight- and 25-second deadlines. If the browser exposes the actual Amanda Multilingual voice while Azure is unavailable, the player can use that same voice and explicitly labels its browser source. Other browser voices require an explicit selection. Rechecking the cloud connection stops active narration before changing transports. Run `npm run test:narration` and `npm run test:journey` for offline route, audio lifecycle, and component checks; these do not verify live Azure access.

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

Module status is one of `not-started`, `in-progress`, `completed`, or `locked`. Quiz results are calculated in the browser; a score of at least 70% passes. No quiz submission endpoint exists. Lessons, quiz results, and progress retain the existing versioned browser storage format.

Failed quiz attempts show explanations and targeted review prompts for the actual missed questions. Review can prefill the existing tutor without changing slides or automatically sending a request. A saved failed score remains visible after refresh; selected answers themselves are not persisted. Retrying a completed module never removes its best passing score or re-locks successors. Results must match the currently cached lesson ID and question count before they can update progress. Narration pauses on tutor interaction or when the page becomes hidden, and stops when leaving the lesson.

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

The parser bounds streamed bodies as well as requests with `Content-Length`. Text, arrays, numeric values, URLs, and nested lesson/quiz objects are validated at runtime; TypeScript alone does not validate network input. Clients should display the server's message and permit retry. No API key is required for mock mode; live curriculum, lesson, and tutor generation require the server's Anthropic key. Invalid configured credentials never return a misleading mock success. Claude failures use the existing `500`/`INTERNAL_ERROR` contract.

Important field limits are listed below. Required nonempty text rejects whitespace-only values; `experience` is a required string that may be blank. IDs are at most 100 characters.

| Object        | Limits                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile       | Name ≤100 characters; background and goals are nonempty and ≤2,000 each; experience may be blank and is ≤2,000; 0–30 skills of ≤100 characters each; finite study hours from 1 to 40. |
| Module        | Title ≤200 characters; description ≤2,000; 0–20 prerequisite IDs; 0–20 resources; 1–20 topics of ≤200 characters; finite duration from 1 to 28,800 minutes (older saved modules retain the one-minute minimum).                           |
| Resource      | Title ≤200 characters; provider ≤100; valid HTTPS URL ≤2,000; known resource type.                                                                                                    |
| Lesson        | Title ≤200 characters; 1–30 slides and 1–20 quiz questions, with unique IDs within each collection.                                                                                   |
| Slide         | Title ≤200 characters; 1–10 topic bullets; narration ≤32,000 characters; stable overview ≤5,000; learning objective ≤600; up to 10 teaching scenes. |
| Quiz question | Question and explanation ≤2,000 characters each; 2–6 options of ≤2,000 characters; integer correct-answer index within the options.                                                   |
| Chat          | Question ≤2,000 characters; 0–20 messages, each with ≤4,000 characters of content and a known role.                                                                                   |

Run `npm run test:smoke` against a running application to exercise the success flow and error contracts for all three tracks.
