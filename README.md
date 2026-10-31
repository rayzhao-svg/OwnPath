# OwnPath

**Everything you need to learn. Nothing you don't.**

OwnPath is a personalized learning platform scaffold built with Next.js App Router, strict TypeScript, Tailwind CSS, browser speech synthesis, and localStorage. Phase 1 connects learner onboarding, a curriculum dashboard, narrated slide lessons, contextual tutor chat, and quizzes using deterministic mock APIs.

## Local development

Use Node.js **24 or newer** and npm.

Production builds use Next.js’s supported Webpack mode to avoid Turbopack worker-port restrictions in sandboxed development environments.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Copying the environment file is optional: mock mode works without an API key. `ANTHROPIC_API_KEY` is reserved for future server-side Claude integration; adding a key does not enable live AI in Phase 1. Never expose it through a `NEXT_PUBLIC_` variable.

| Command              | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `npm run dev`        | Start the development server on port 3000.                        |
| `npm run typecheck`  | Generate Next.js route types and check strict TypeScript.         |
| `npm run lint`       | Run ESLint with no warnings permitted.                            |
| `npm run build`      | Build the production application.                                 |
| `npm start`          | Serve an existing production build on port 3000.                  |
| `npm run test:smoke` | Check page routes and the mock API flow against a running server. |

Run the smoke checks in a second terminal while the server is running. To check another server, use `BASE_URL=http://localhost:3001 npm run test:smoke`.

If another project is using port 3000, start OwnPath with `npm run dev -- --port 3001` and open [localhost:3001](http://localhost:3001).

## Try the learning flow

1. Visit `/` and create a learner profile at `/onboarding`, or explore the sample curriculum.
2. Choose Data Science, Web Development, or Product Design. Enter your background, experience, skills, goals, and weekly study time.
3. View your plan at `/dashboard` and open an available module at `/learn/[id]`.
4. Read the slides or play browser narration, ask the mock tutor a question, and complete the quiz.
5. Pass the quiz to complete the module and unlock the next part of the curriculum.

Mock personalization uses a fixed course catalog and simple profile-based rules. It is a product demonstration, not an AI-generated curriculum or a verified assessment of prior learning.

## Persistence and limitations

The active profile, plan, lesson cache, and quiz progress stay in localStorage in the current browser and origin. Retakes retain the best recorded score and completed module status. They are not synced across devices or accounts. Clearing browser storage removes them. Chat is session-local. The interface reports storage failures so learners can continue without persistence.

Narration uses `window.speechSynthesis`; available voices and playback behavior depend on the browser and operating system. Slide text and narration transcripts remain available when speech is unsupported. No audio files are generated or uploaded.

There is no live AI, authentication, database, resume/PDF parsing, or video generation. API responses include `mode: "mock"`, and quiz answers are deliberately visible to the client. APIs and client-side progress are suitable for a local prototype, not trusted grading or access control.

## Project structure

```text
app/                 Pages, layouts, styles, and API route handlers
components/          Profile, curriculum, lecture, tutor, and quiz interfaces
lib/types.ts         Shared domain types and request/response contracts
lib/ai.ts            Mock adapter and future AI integration boundary
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

The project uses standard Next.js conventions and can be imported into Vercel. Use `npm run build` as the build command and the default Next.js output settings. No environment variables or database services are required for mock mode. Deployment, commits, and pushes are outside this local implementation.
