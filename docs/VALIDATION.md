# Phase 1 local validation

Validation performed October 30, 2026. All changes are local; no commit, push, or deployment was made.

## Repository and runtime

- Initial Git status showed an empty, clean repository with no commits. Fetching the configured origin succeeded; the remote had no branches or commits to incorporate.
- npm dependencies were installed and a lockfile was generated. The project requires Node.js 24 or newer.
- Port 3000 was already serving an unrelated Dartmouth repository and was preserved. OwnPath's development server runs at [localhost:3001](http://localhost:3001) using `npm run dev -- --port 3001`.
- Production builds use `next build --webpack` because the sandbox restricts Turbopack worker ports.

## Automated checks

| Check                       | Result                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run typecheck`         | Passed.                                                                                           |
| `npm run lint`              | Passed with no warnings.                                                                          |
| `npm run build`             | Passed using Webpack.                                                                             |
| Expanded HTTP smoke suite   | Passed 832 counted assertions, including generation of all 18 catalog lessons, at localhost:3001. |
| Production dependency audit | Zero vulnerabilities reported.                                                                    |
| Full dependency audit       | 16 moderate findings in the development-only minimatch dependency tree.                           |

The development audit findings are transitive through the ESLint 9 toolchain. ESLint 10 conflicts with a supported lint plugin's peer dependency, so ESLint 9 is retained. Runtime dependencies have no audit findings. Revisit lint tooling compatibility when the plugin supports ESLint 10.

The smoke script checks all four page routes; plan, lesson, and tutor flows for Data Science, Web Development, and Product Design; IDs and prerequisite relationships; resource URLs; slide and quiz contracts; blank experience and skills; and malformed, missing, invalid nested, and oversized request errors. The expanded suite generates lessons for every module, including locked modules, because the mock API is stateless and module availability is managed in the browser.

Run it against the current server:

```sh
BASE_URL=http://localhost:3001 npm run test:smoke
```

## Browser checks

- Desktop and mobile layouts were inspected. Landing, onboarding, dashboard, and lesson pages had no horizontal overflow at a 390px viewport.
- Profile submission accepted blank work experience and created a curriculum.
- Tutor chat returned a contextual mock response.
- Slide navigation and the narration transcript worked.
- Browser narration play, pause, and stop controls were exercised.
- A 100% quiz result completed the module and unlocked the next module.
- The cached lesson and recorded quiz result survived a page reload.
- A locked lesson showed its recovery path to the curriculum.

Browser speech voices and playback behavior depend on the browser and operating system. LocalStorage progress remains editable browser state, and quiz answers are visible in mock responses. These checks validate the local Phase 1 prototype; they do not establish trusted grading, live AI quality, or cross-device persistence.

## New files and Git status

All files below are new and untracked because the repository has no initial commit. There are no staged changes or merge conflicts. Generated dependencies and build output are ignored.

| Group              | Files                                                                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration      | `.env.example`, `.gitignore`, `AGENTS.md`, `eslint.config.mjs`, `next-env.d.ts`, `next.config.ts`, `package.json`, `package-lock.json`, `postcss.config.mjs`, `tsconfig.json`                                                                                         |
| Pages and styles   | `app/page.tsx`, `app/onboarding/page.tsx`, `app/dashboard/page.tsx`, `app/learn/[id]/page.tsx`, `app/layout.tsx`, `app/error.tsx`, `app/not-found.tsx`, `app/globals.css`, `app/learn/lesson.css`                                                                     |
| API routes         | `app/api/plan/route.ts`, `app/api/lesson/route.ts`, `app/api/chat/route.ts`                                                                                                                                                                                           |
| Components         | `components/app-shell.tsx`, `components/brand.tsx`, `components/curriculum-view.tsx`, `components/icon.tsx`, `components/profile-form.tsx`, `components/lecture-player.tsx`, `components/lecture-chat.tsx`, `components/lesson-experience.tsx`, `components/quiz.tsx` |
| Shared logic       | `lib/types.ts`, `lib/ai.ts`, `lib/mock-data.ts`, `lib/api-client.ts`, `lib/learning-context.tsx`, `lib/validators.ts`, `lib/validation.ts`                                                                                                                            |
| Documentation      | `README.md`, `docs/API_CONTRACTS.md`, `docs/ARCHITECTURE.md`, `docs/TEAM_WORKSTREAMS.md`, `docs/VALIDATION.md`                                                                                                                                                        |
| Integration checks | `scripts/smoke.mjs`                                                                                                                                                                                                                                                   |

`AGENTS.md` was generated by Next.js and retained. No existing application infrastructure or unrelated local server was overwritten.
