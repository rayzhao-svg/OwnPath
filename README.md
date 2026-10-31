# OwnPath

**Everything you need to learn. Nothing you don't.**

OwnPath is a personalized learning platform built with Next.js App Router, strict TypeScript, Tailwind CSS, browser speech synthesis, and localStorage. The Phase 4 integration connects resume onboarding, editable learner profiles, Claude curricula and lessons, contextual tutor chat, quizzes, targeted remediation, and adaptive progression. See the [Phase 4 integration report](docs/PHASE4_INTEGRATION.md) for validation and remaining limitations.

## Local development

Use Node.js **24 or newer** and npm.

Production builds use Next.js’s supported Webpack mode to avoid Turbopack worker-port restrictions in sandboxed development environments.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Copying the environment file is optional: mock mode works without an API key. Set `ANTHROPIC_API_KEY` on the server to enable Claude curriculum, lesson, tutor, and review generation, then restart the server. Never expose it through a `NEXT_PUBLIC_` variable. Resume organization with Claude requires a separate opt-in in the upload panel.

| Command              | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `npm run dev`        | Start the development server on port 3000.                        |
| `npm run typecheck`  | Generate Next.js route types and check strict TypeScript.         |
| `npm run lint`       | Run ESLint with no warnings permitted.                            |
| `npm run build`      | Build the production application.                                 |
| `npm start`          | Serve an existing production build on port 3000.                  |
| `npm run test:smoke` | Check page routes and the mock API flow against a running server. |
| `npm run test:integration` | Check generated-content contracts and Phase 3 integration with stubbed provider transport. |
| `npm run test:journey` | Check narration, tutor retry, and quiz component handlers. |
| `npm run test:quiz` | Check fresh question generation, attempt snapshots, history, and retry states. |
| `npm run test:resources` | Check topical lesson readings, deduplication, and existing resource preservation. |
| `npm run test:learning-track` | Check goal-based direction selection without redundant track cards. |
| `npm run test:smoke:enhancements` | Check lesson details, variable quizzes, historical reviews, and narration errors over HTTP against an isolated mock server. |
| `npm run test:lesson-detail` | Check expanded teaching scenes, audio frames, safe upgrades, and saved progress. |
| `npm run test:resume` | Check PDF/TXT parsing, grounded extraction, privacy, and editable onboarding. |
| `npm run test:phase4` | Check remediation, persistence migration, stale requests, and adaptive prerequisites. |
| `npm run test:phase4:smoke` | Run two synthetic resume-to-review HTTP journeys; defaults to port 3001 and uses live Claude when configured. |

Run the smoke checks in a second terminal while the server is running. To check another server, use `BASE_URL=http://localhost:3001 npm run test:smoke`.

If another project is using port 3000, start OwnPath with `npm run dev -- --port 3001` and open [localhost:3001](http://localhost:3001).

## Try the learning flow

1. Visit `/` and create a learner profile at `/onboarding`, or explore the sample curriculum. Optionally upload a selectable-text PDF or UTF-8 TXT resume (up to 2 MB), or paste up to 16,000 characters.
2. Enter your background, experience, skills, goals, and weekly study time. Your goal supplies the learning direction.
3. Review and edit extracted education, experience, and skills before confirming your profile and creating a path. Files and source text are processed in memory; only your reviewed profile is saved with your path.
4. View your plan at `/dashboard` and open an available module at `/learn/[id]`.
5. Read the slides or play narration, ask the contextual tutor a question, and complete the quiz.
6. Choose 5–10 questions (five by default) and generate a quiz grounded in the lesson. Review explanations, worked examples, and practice steps for missed questions, then retry with a fresh set of your chosen size. Pass with at least 70% to complete the module and unlock modules whose prerequisites are all complete.

Mock personalization uses a fixed course catalog and simple profile-based rules. It is a product demonstration, not an AI-generated curriculum or a verified assessment of prior learning.

## Persistence and limitations

The active profile, plan, lesson cache, assessment history, latest and best results, and targeted reviews stay in localStorage in the current browser and origin. Each retry requests 5–10 new lesson-based questions from Claude, excluding the current and recent questions. Unconfigured mock mode uses a finite lesson-based question bank and reports exhaustion. Generation failures preserve the existing quiz and score for a retry. Retakes retain the best recorded score and completed module status; each attempt stores its questions so older reviews and answers remain accurate. Existing Phase 3 version-1 stores migrate without resetting progress. They are not synced across devices or accounts. Clearing browser storage removes them. Chat and raw resume source are session-local. The interface reports storage failures so learners can continue without persistence.

Lessons show four or five relevant readings from the module's original sources and an official or academic catalog matched to lesson topics. Cached lessons receive the expanded reading list immediately. The shared sidebar keeps the “Powered by Claude” credit beneath the OwnPath wordmark.

Lessons automatically expand into guided teaching scenes with definitions, worked examples, intermediate results, and common mistakes. The original lesson stays usable while expansion runs; a failure offers a retry. Updates preserve quiz questions, scores, and review history. Without an AI key, existing narration is split into readable scenes without inventing additional teaching.

Lesson narration defaults to Azure Speech’s Amanda Multilingual (`en-US-AmandaMultilingualNeural`). Add `AZURE_SPEECH_KEY` and the matching `AZURE_SPEECH_REGION` to `.env.local`, then restart the server. Narration is split into short audio frames: each frame's exact text appears as a caption while code, calculations, comparisons, and emphasis change with the teaching scene. The next frame is prepared during playback to reduce gaps. Only narration text is sent to Azure after you press Play; the key remains on the server. Audio is cached briefly in memory and is not saved to disk or browser storage. The player supports manual explanation navigation, pause/resume, speed controls, and automatic scene and slide progression. It stops on navigation and pauses for tutor questions or hidden pages. A connection failure stays visible and does not silently substitute a browser voice. Reduced-motion preferences disable entrance animations.

The Voice selector also offers installed browser voices as an explicit alternative and remembers your choice in this browser. Browser voices use `window.speechSynthesis`; availability and quality depend on the browser and operating system. Reading slides and transcripts requires no speech credentials. Use `npm run test:narration` for the offline Azure route and audio playback regressions; these use stubbed transport and do not claim live Azure success.

There is no authentication, database, scanned-PDF OCR, or video generation. API responses distinguish Claude from mock content; resume extraction reports `claude` or `fallback`. An unconfigured key uses deterministic mock content. Configured curriculum, lesson, and tutor failures expose a safe retryable error; resume organization and targeted review can fall back to local rules or the saved lesson. Quiz answers are deliberately visible to the client. APIs and client-side progress are suitable for a local prototype, not trusted grading or access control.

## Project structure

```text
app/                 Pages, layouts, styles, and API route handlers
components/          Profile, curriculum, lecture, tutor, and quiz interfaces
lib/types.ts         Shared domain types and request/response contracts
lib/ai.ts            Curriculum adapter and deterministic mock content
lib/resume.ts        Memory-only parsing and grounded resume extraction
lib/remediation.ts   Mistake diagnostics and targeted review validation
lib/mock-data.ts     Course catalog and deterministic mock generators
lib/validators.ts    Shared runtime domain validation (server and browser)
lib/validation.ts    Bounded JSON parsing and HTTP errors
lib/api-client.ts    Typed browser API calls
lib/learning-context.tsx  Browser state and local persistence
docs/                API, architecture, and team development boundaries
scripts/smoke.mjs    HTTP route and contract integration checks
```

See [API contracts](docs/API_CONTRACTS.md), [architecture](docs/ARCHITECTURE.md), [team workstreams](docs/TEAM_WORKSTREAMS.md), and [local validation results](docs/VALIDATION.md).

## Deployment

The project uses standard Next.js conventions and can be imported into Vercel. Use `npm run build` as the build command and the default Next.js output settings. No environment variables or database services are required for mock mode. Deployment and remote pushes are separate from local development.
