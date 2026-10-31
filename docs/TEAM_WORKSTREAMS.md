# Team workstreams

Keep parallel development isolated by file ownership and shared contracts. `lib/types.ts` is the single source of truth: agree on additions there before changing producers or consumers. Changes to API envelopes, IDs, field units, or enum values need coordinated review across affected workstreams.

## Ownership boundaries

| Workstream                 | Primary files                                                                                                                                                                               | Responsibility                                                                                                 | Integration boundary                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend and learner state | `app/page.tsx`, `app/onboarding/`, `app/dashboard/`, shared layout/styles, `components/profile-form.tsx`, `components/curriculum-view.tsx`, `lib/learning-context.tsx`, `lib/api-client.ts` | Profile capture, navigation, responsive curriculum, local persistence, loading/error states, progress display. | Consume shared API types; request plans through the client helper; expose provider actions to the lecture flow.                                   |
| Curriculum AI              | `lib/ai.ts`, plan generation in `lib/mock-data.ts`, `app/api/plan/route.ts`                                                                                                                 | Profile-to-plan rules now; future server-only Claude adapter, structured outputs, and plan quality.            | Return `StudyPlan` with stable IDs, valid prerequisite relationships, known status values, and duration units.                                    |
| Lecture and tutor          | `app/learn/`, `components/lecture-player.tsx`, `components/lecture-chat.tsx`, `components/lesson-experience.tsx`, `app/api/lesson/route.ts`, `app/api/chat/route.ts`                        | Slides, narration, contextual questions, lesson loading/cache behavior, and recovery UI.                       | Produce/consume `Lesson` and `TutorMessage`; use provider actions for module progress. Coordinate catalog edits with curriculum/resources owners. |
| Resources and assessment   | Resource and quiz content in `lib/mock-data.ts`, `components/quiz.tsx`                                                                                                                      | Resource relevance and link quality, quiz options/explanations, grading UX, and assessment feedback.           | Preserve resource/quiz interfaces; `QuizResult` references both lesson and module; delegate progress transitions to the provider.                 |

## Shared files and coordination

- Treat `lib/types.ts`, `lib/validators.ts`, `lib/validation.ts`, package/configuration files, and the shared course catalog as coordinated files. Assign one editor at a time for overlapping changes.
- The catalog currently holds plan, slide, resource, and assessment content together. Split it into dedicated modules when parallel content work needs separate ownership, preserving the exports consumed by `lib/ai.ts`.
- Keep route handlers thin. Domain assertions and request parsers belong in client-safe `lib/validators.ts`; bounded body parsing and HTTP error handling belong in server-side `lib/validation.ts`. AI behavior belongs behind the server adapter.
- Use module IDs as relationships. Keep lesson parent IDs, prerequisite IDs, resource IDs, slide IDs, and quiz IDs stable when changing copy.
- Do not add API keys or AI SDK calls to components. Secrets belong in ignored server environment files.
- Keep browser state mutations in the learning provider so completion and prerequisite unlocking follow one implementation.

## Handoff checks

Each workstream should report changed files, contract changes, validation run, and any limitations. Before integration, run typecheck and lint; run the production build and HTTP smoke flow after shared changes. Check the relevant interaction in a browser, including keyboard use, loading/error states, and a narrow viewport.

Future work should replace one boundary at a time: strengthen curriculum generation behind `lib/ai.ts`, add trusted persistence and identity before secure grading, then expand resource discovery and adaptive assessment. PDF parsing, video generation, and live AI are separate later-phase work.
