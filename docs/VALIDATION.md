# Learning experience validation

## Course depth and narration alignment — 2026-10-31

Replaced proportional line highlighting with explicit per-line narration and a visual-line index on each runtime audio frame. Short explanations now visit intermediate lines; longer explanations retain their line across several clips. New AI chapters stop at chapter boundaries, and one-chapter background preparation does not interrupt active audio. The player waits for a completed content consistency review before playing a new AI chapter. Legacy and mock narration remain compatible.

New course outlines contain eight ordered chapters with objectives and stable introductions. Each chapter loads independently with seven substantive pedagogical sections, paired visual/spoken steps, derivations or mechanisms, a worked example, misconception, guided and independent practice, and synthesis. Saved shorter lessons receive deeper chapter patches without replacing quizzes, attempts, or progress. A separate bounded model review checks arithmetic, assumptions, code, and narration/display consistency, applying only targeted paired corrections within the same 75-second generation budget. This review is an additional correctness check, not a mathematical proof.

Live verification produced an eight-chapter advanced simulation/Monte Carlo outline in 32.8 seconds and a reviewed 1,977-word chapter in 48.4 seconds (38,346 response bytes). Every teaching section had exact one-to-one visual/narration correspondence. Independent arithmetic checks confirmed the displayed sample means, variances, and standard errors; a 4.91-second targeted review corrected a sampling-design assumption by explicitly conditioning the illustrative sample on an iid model. The marked saved Python chapter was upgraded in the browser and its second visual line was visibly highlighted rather than skipped.

Regression coverage includes 284 narration/player journeys; 99 course generation/review assertions; 122 chapter-state/client/parent assertions; and 43 context/persistence/review-wire assertions. Existing integration, assessment, resume, neural audio, and migration suites also pass. API requests use compact context under the original 64 KiB body limit while stored course content has a separate 512 KiB limit. Historical review questions are sent once, preserving the original attempt snapshot in storage.

## High-hour advanced curriculum regression — 2026-10-31

A follow-up report reproduced five failed curriculum attempts for an advanced reinforcement-learning goal at 40 hours/week. Safe diagnostics isolated `Invalid curriculum duration`: the Claude assembler rejected modules above 2,400 minutes despite allowing a total twelve-week budget of 28,800 minutes. The shared module validator had a separate 10,000-minute ceiling. The earlier live walkthrough used five hours/week and did not exercise this case.

Curriculum duration limits now share one budget definition. Generated modules retain integer durations from 30 minutes up to the learner's full twelve-week budget; the sum must still fit that budget. Shared ingestion, persistence, and lesson-request validation accept durations up to the maximum supported budget of 28,800 minutes, preserving older one-minute modules. Workload estimates are not truncated or scaled. The prompt receives the numeric total budget explicitly. Invalid generated plans and unreachable readings now have distinct safe errors instead of suggesting an API-key problem. Temporary diagnostics were removed.

Live verification of the same advanced goal at 40 hours/week returned HTTP 200 with `mode: claude` in 17.1 seconds: five modules of 2,400, 4,200, 5,400, 5,400, and 6,600 minutes, totaling 24,000 minutes within the 28,800-minute budget. Verification used a synthetic profile and did not replace the learner's saved plan. New offline regressions cover larger modules, unchanged duration estimates, client/lesson parsing, integer/minimum/global/total bounds, and existing progress.

## AI reliability and Amanda connection follow-up — 2026-10-31

Fixed premature provider/client deadlines, duplicate in-flight provider work, blocking source checks, quiz waiting for optional background teaching, and misleading narration availability. The shared transport allows cold structured-output setup and retries only one explicit transient HTTP rejection; it never replays an ambiguous timed-out completion. Concise grounded teaching scenes are accepted without requiring an arbitrary aggregate narration length. Code examples with more than five short lines are grouped into display steps without dropping or reordering any text.

`test:requests` adds 54 browser/provider assertions for cold requests, complete-response deadlines, cancellation, coalescing, bounded overload recovery, source-check overlap/cache, and no replay after malformed completions. Existing integration, quiz, persistence, resume, detailed teaching, player, narration, resources, and direction suites pass. Zero-warning lint, TypeScript, production build, and whitespace checks pass. The isolated mock HTTP suites pass 832 route/contract, 174 resume-to-review, and 166 enhancement assertions.

Live synthetic browser checks verified a one-click Claude curriculum in 20.3 seconds, a lesson in 18.1 seconds, five fresh quiz questions in 8.2 seconds, a contextual tutor response in 3.5 seconds, and the corrected four-slide teaching expansion in 16.6 seconds. The existing Azure Speech resource was connected locally using its actual region. Its regional catalog confirms Amanda, and a short narration returned HTTP 200 audio/mpeg (46,944 bytes) in about one second. Secrets remain in ignored `.env.local` with owner-only file permissions and are not in repository changes or test output.

## Working-copy verification — 2026-10-31

The final working copy passes zero-warning lint, TypeScript checks, the production Webpack build, and whitespace checks. The offline suites passed **1,869 assertions**:

| Suite | Assertions |
| --- | ---: |
| Integration / Phase 4 / resume | 182 / 143 / 420 |
| Quiz generation / history / UI / parent | 234 / 68 / 66 / 53 |
| Detailed lesson / teaching-state integration | 162 / 83 |
| Animated-player and interaction journeys | 135 |
| Narration route / audio engine / voice choice | 123 / 64 / 14 |
| Resources / goal-based direction | 95 / 27 |

An isolated production server on port 3004 used placeholder process credentials, leaving the configured development server and its credentials unchanged. `test:smoke`, `test:phase4:smoke`, and `test:smoke:enhancements` passed **832**, **174**, and **166** HTTP assertions respectively. These cover all three tracks and eighteen catalog lessons, resume-to-review journeys, detailed scenes, five- and ten-question fresh quizzes, historical reviews after quiz replacement, passing-score guidance, invalid requests, and unconfigured Amanda errors. These mock HTTP results do not claim live provider success.

A browser walkthrough on a separate localhost origin created a synthetic web-development profile, loaded a lesson, generated and passed a five-question quiz, generated ten fresh questions, and reloaded. The best score stayed at 100%, the completed module stayed complete, and its successor unlocked. The lesson showed four resources and shared Claude branding. At 390 × 844, document width equaled viewport width with no horizontal overflow; the viewport override was reset. The temporary browser tab and test server were closed after verification.

The configured live development lesson was also verified during implementation: Claude expanded the SQL lesson into detailed teaching scenes, and Amanda automatically advanced the matching captions and visuals from an order-count query to a repeat-rate calculation. Pause/resume held the caption in place. Earlier live checks confirmed consecutive fresh Claude quizzes and saved-score persistence.

Final verification fixed browser speech remaining globally paused after stop or navigation, removed obsolete three-question passing guidance, and updated older integration flows to generate at least five questions before grading. Lesson expansion and quiz generation are serialized, and combined payload limits are checked before state updates; rejected updates retain current answers, history, and progress. Credentials and generated build files remain ignored.

## Repository provenance

The Phase 3A audit found both Phase 2 implementations in commit `9565069` (`Phase 2 API Key Integration`): `lib/claude-plan.ts`, `lib/claude-lesson.ts`, and `lib/claude-tutor.ts` were present together. That commit was merged into `origin/main` by `e44078e`. The local `feature/ai-curriculum` branch still pointed at the initial Phase 1 commit, so its branch name alone was not evidence that the feature was missing.

The audit checked all local/remote branches, the worktree list, uncommitted changes, and fetched remote history. There was one worktree and a clean tree. The isolated local branch `feature/phase3a-integration` was created from verified `origin/main`; existing feature branches were preserved. Integration work does not require a reset, force push, or replacement of either Phase 2 implementation.

## Required checks

Use Node.js 24 or newer. Run the following checks on the integration branch:

```sh
npm run typecheck
npm run lint
npm run build
npm run test:integration
npm run test:journey
```

The production build uses `next build --webpack`. `test:integration` exercises the actual route handlers, adapters, client validation, quiz/progression handlers, and storage restoration with a stubbed provider and fake credentials. It makes no live API calls. It checks generated module compatibility, current/prior slide context, invalid credentials/output, and curriculum graph validation. Generated dependencies and build output are ignored. Neither build logs nor tests should print credentials. Test output must distinguish actual live Claude calls from stubbed-provider coverage.

## Mock HTTP smoke suite

The existing smoke suite expects mock responses. Run it against an isolated production process with a process-scoped dummy key, preserving any real key in `.env.local` and the running live development server:

```sh
ANTHROPIC_API_KEY=YOUR_API_KEY_HERE npm run start -- --port 3002
```

From another terminal:

```sh
BASE_URL=http://127.0.0.1:3002 npm run test:smoke
```

Use another free port if needed. Stop only the test process when finished. The suite covers page rendering, all three endpoints across all tracks, all 18 canonical mock lessons, prerequisite relationships, resources, nested slide/quiz contracts, beginner inputs, and malformed, invalid, and oversized request errors. Rerun it for every integration delivery rather than treating a historical result as a current pass.

Missing, blank, and dummy keys must return mock responses for compatible catalog inputs. Invalid configured credentials must return actionable `INTERNAL_ERROR` responses, never a mock success. Saved Claude modules still need a configured key; removing the key does not convert them into catalog modules.

## Live integration acceptance

Use the existing server-side `ANTHROPIC_API_KEY` without printing it or placing it in browser code. Restart OwnPath after changing the key. The usual development URL is [localhost:3001](http://127.0.0.1:3001), started with `npm run dev -- --port 3001` when port 3000 is occupied.

1. Complete onboarding with a specific goal, background, experience, skills, and weekly study time. Confirm `/api/plan` returns HTTP 200 with `mode: "claude"`.
2. Inspect the resulting dashboard: unique module IDs, valid acyclic prerequisites, an available starting module, positive durations, valid statuses, and HTTPS resources from the verified catalog. Check that total time fits the plan's weekly budget and scope.
3. Open an available module. Pass that exact object to `/api/lesson`; confirm HTTP 200, `mode: "claude"`, matching module ID/title, 4–6 slides, and three quiz questions. Review coverage of the selected module's actual topics and worked examples.
4. Play narration, pause, resume, and switch slides. Navigation must stop speech, and the transcript must remain usable when speech synthesis is unsupported.
5. Ask about the current slide, then follow up. Confirm the tutor uses the lecture, active slide, and previous answer. Change slides and ask another follow-up to verify both current and prior slide context. Technical question prefixes must remain hidden from the displayed conversation.
6. Complete the quiz in disposable test state. A passing score must complete the module and unlock eligible successors. Reload the dashboard and lesson to verify cached content and progress survive. Preserve any existing learner data when testing.
7. Check safe retry behavior for failed generation, malformed provider output, and invalid credentials. Test credential failures with dummy process environments or provider stubs; do not overwrite the user's real key.

Live plan/module/lesson/tutor verification is separate from mock smoke and stubbed-provider tests. Record actual response modes and failure results in the delivery report; do not claim live success from TypeScript compilation alone.

## Practical limits

Browser voices and playback behavior depend on browser/OS support. Tutor conversation history is kept in the mounted lesson interface and resets on reload; lesson/quiz progress remains in the existing versioned browser store. LocalStorage and client-visible quiz answers are editable, so this is not trusted grading or cross-device persistence. Academic URL reachability establishes that the configured page exists, not that every generated claim or teaching example has been independently reviewed. Phase 3A adds no authentication, database, video rendering, voice recognition, or real-time streaming.

## Phase 3A delivery results

- Typecheck, zero-warning lint, production build, and diff whitespace checks passed.
- `npm run test:integration`: **122 assertions passed** with stubbed provider transport, including safe invalid-credential errors for all three endpoints.
- Mock HTTP smoke suite: **832 assertions passed** on an isolated dummy-key process, including all three tracks and 18 canonical lessons. The configured local key was not changed.
- Additional existing offline adapter/player harnesses passed **483**, **251**, and **20** assertions respectively; these are temporary local checks rather than the durable repository suite.
- Live browser acceptance used synthetic learner data on an isolated port-3003 origin, preserving existing learner storage. Onboarding generated a five-module personalized curriculum; its first module produced a matching five-slide Claude lesson and three quiz questions. The contextual tutor answered a current-slide question and a follow-up using the prior example; focusing the tutor paused active narration. A 100% quiz result completed the module, unlocked module two, and persisted after dashboard reload. Reviewing the cached lesson restored the saved lesson and passed quiz result.
- The existing development server remains at `http://127.0.0.1:3001`. Temporary test processes were stopped. No remaining integration blockers were found; Phase 3B can begin from this local branch after review. No commit or push was performed.

## Phase 3B delivery results

All existing Phase 3A changes were preserved in the integrated local checkout. Typecheck, zero-warning lint, production build, and whitespace checks passed. The durable offline suites passed **178 integration assertions** and **32 UI journey assertions**; the isolated dummy-key HTTP suite passed **832 smoke assertions**. `test:journey` uses actual component handlers with stubbed speech/provider transport; it does not substitute for the live browser checks below.

| Scenario | Verification and result |
| --- | --- |
| A: beginner with Excel/algebra | Live `/api/plan` returned `claude`, five modules in 17.4 seconds. Content starts with Python for spreadsheet users, SQL, and statistical foundations before churn modeling. A separate fresh browser onboarding journey reached the dashboard and a six-slide lesson with three relevant quiz questions. |
| B: Python/statistics experience, same goal/time | Live `/api/plan` returned `claude`, six modules in 19.4 seconds. It condenses Python/SQL/basic statistics and emphasizes leakage, temporal validation, imbalance-aware metrics, regularization, calibration, interpretation, and reproducible delivery. Actual topics and difficulty differ from A. |
| C: consecutive questions on one slide | Browser tutor explained the worked loop count of two, then reused the same example to explain a changed threshold producing three. Slide four remained selected; narration paused and the conversation remained intact. |
| D: failure, review, retry | Browser test intentionally scored 0%. Explanations and per-question review appeared. A review button prefilled the existing tutor with the actual missed question, chosen/correct answers, and explanation, without an automatic request. Refresh retained the failed score and Claude lesson label; a retry then scored 100%. |
| E: prerequisite unlocking | Passing the live quiz completed module one and made module two available. A failed practice retry cannot remove an earlier passing score or re-lock completed progress (offline regression). |
| F: refresh/replacement | Live dashboard reload retained the completed module, unlocked successor, plan, and Claude mode. An isolated mock browser journey completed a module and regenerated the same profile: progress reset to zero and successors re-locked. Offline tests verify cache/result clearing and rejection of late responses even when mock plan/module IDs repeat. Legacy stores without mode metadata remain readable. |
| G: failures and fallback | Missing/blank/dummy keys, invalid configured credentials, malformed output, and failed provider requests were checked with safe offline transport fixtures. Client network/JSON failures and tutor retries preserve prior conversation. Dummy-key HTTP/UI tests showed distinct mock labels. The real configured key was never changed or printed. |

Responsive browser inspection at **390 × 844** showed a single-column lecture/tutor/quiz layout with no horizontal overflow (`scrollWidth` and viewport width both 390). The viewport override was reset afterward. Narration cancellation on page exit/unmount and pause on hidden pages are covered by the speech journey tests.

Optional version-1 mode metadata preserves correct labels after reload, and a fresh local generation token prevents asynchronous results from older plans contaminating replacement plans. No endpoint request or response structure changed. Known limits remain browser-dependent voice behavior, local editable practice scoring, and in-memory tutor conversations that reset on reload; selected quiz answers are not persisted, while quiz scores and completion are. No unresolved Phase 3 blocking defect was found. Phase 4 can begin after reviewing the uncommitted changes.
