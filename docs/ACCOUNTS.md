# Accounts and saved learning paths

OwnPath supports local email/password accounts and a separate library of learning paths for each account. A learner can keep several paths in the same direction, switch between directions, sign out, and sign back in to recover their lessons, completed modules, quizzes, question snapshots, and review history. Guest learning remains available. Moving guest paths into an account requires the learner's explicit import action.

## Runtime and durable storage

The account server runs on **Node.js 24 or newer**, using its built-in `node:sqlite` and `node:crypto` modules. No external identity service, database subscription, or additional package is required. Authentication and account storage do not call the AI or speech providers.

The database path is configured on the server:

```dotenv
# Optional; defaults to .data/ownpath.sqlite in the application working directory.
OWNPATH_DATABASE_PATH=/absolute/path/on/persistent/storage/ownpath.sqlite
```

The default `.data/` directory is ignored by Git. The server creates the directory with private permissions and restricts the database file to its owner. SQLite uses write-ahead logging, full synchronous commits, foreign keys, and a five-second busy timeout. Connections open lazily, so building the application and checking an anonymous session do not create a database.

Use a writable **persistent local volume** when deploying. Keep the SQLite database and its `-wal` and `-shm` files together. For backups, stop the application before copying these files, or use SQLite-aware backup tooling. Account data survives application restarts when the database file is retained. An ephemeral filesystem loses that data when the instance is replaced. This storage design serves a Node application instance with its local database; deployments with multiple independent instances need a shared database architecture. Do not put the SQLite file on an arbitrary network filesystem.

Use HTTPS in production. Production session cookies carry `Secure`, so an ordinary insecure production origin cannot establish the intended browser session. Never expose the database path or server credentials through `NEXT_PUBLIC_` variables.

### Vercel deployment

Vercel deployments run in guest mode because function filesystems do not provide the durable SQLite storage required by accounts. When `VERCEL=1`, the account page explains browser-only persistence, account creation and sign-in return `503 ACCOUNTS_UNAVAILABLE`, and stale session cookies cannot open the database. Sign-out still clears the browser cookie. Guest paths, lessons, quizzes, and progress remain in localStorage for the current browser and site origin; clearing that storage removes them. Cross-device account sync requires a shared database implementation or a Node host with a persistent disk. Local deployments retain the existing SQLite account behavior.

## Authentication and session behavior

Registration accepts a name of 1–100 characters, an email address of at most 254 characters, and a password of 12–128 characters. Email identifiers are trimmed and lowercased. Passwords retain their exact characters.

Passwords are derived with asynchronous scrypt (`N=32768`, `r=8`, `p=3`), a random 16-byte salt, and a 64-byte derived key. These parameters match the 32 MiB alternative in the [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt). The stored hash includes its algorithm and work parameters. Earlier unprefixed `p=1` records still verify with their original parameters and are upgraded with a fresh salt after a successful sign-in, using an atomic update so concurrent upgrades cannot overwrite each other. A failed sign-in leaves the hash unchanged.

Comparisons use `timingSafeEqual`. Unknown email addresses still perform a password derivation and receive the same sign-in error as incorrect passwords. Passwords and session secrets are excluded from account JSON responses. Derivations share a process-wide capacity limit of two active jobs and eight waiting jobs; excess requests receive HTTP 429 with a short `Retry-After`, keeping expensive work bounded before it enters the native worker pool.

Successful registration or sign-in creates a random 256-bit session secret. The browser receives an `HttpOnly; SameSite=Lax; Path=/` cookie with a 30-day lifetime; production adds `Secure`. SQLite stores the secret's SHA-256 hash and expiry. Signing in rotates the current session, signing out revokes it, and expired sessions cannot authenticate. Other device sessions remain independent.

Database-backed request windows limit repeated authentication work and survive process restarts. Login attempts are limited per email, with a successful sign-in clearing that email window. Address and global limits also bound authentication traffic. A throttled response returns HTTP 429 and `Retry-After`.

The current account flow includes registration, sign-in, session restoration, and sign-out. It has no password recovery, email confirmation, social sign-in, or email delivery service.

## API contracts

All account responses use `Cache-Control: private, no-store`. Errors use `{ error: { code, message } }`. Account writes require same-origin JSON requests, except sign-out, which accepts an empty POST. Cross-origin and cross-site browser writes are rejected. Credential bodies are limited to 16 KiB.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/auth/register` | `{ name, email, password }` | HTTP 201, `{ user: { id, name, email } }` and a session cookie |
| `POST /api/auth/login` | `{ email, password }` | `{ user }` and a rotated session cookie |
| `GET /api/auth/session` | Session cookie, when available | `{ user }` or `{ user: null }` |
| `POST /api/auth/logout` | Current session cookie | `{ user: null }` and an expired cookie |
| `GET /api/account/tracks` | Expected account header | `{ tracks: AccountTrackSummary[] }` |
| `POST /api/account/tracks` | `{ state }`, optional `Idempotency-Key` | HTTP 201, `{ track: AccountTrack }` |
| `GET /api/account/tracks/[id]` | Expected account header | `{ track: AccountTrack }` |
| `PUT /api/account/tracks/[id]` | `{ state, revision }` | `{ track }` with the next revision |
| `DELETE /api/account/tracks/[id]` | `{ revision }` | `{ deleted: true }` |

Every track operation also requires the session cookie and `X-OwnPath-Account: <expected user ID>`. The server compares the header with the authenticated user before reading or writing progress. A session that changed in another tab returns HTTP 409 with `ACCOUNT_CHANGED`, preventing queued state from one account being saved into another. Track lookup, update, and deletion queries always include the authenticated owner; a record belonging to another account returns HTTP 404.

An `AccountTrack` contains `{ id, revision, updatedAt, state }`. Its record ID is a new opaque UUID independent of `state.plan.id`, so deterministic mock plan IDs do not prevent saving several paths with the same goal. `state` uses the existing version-1 `LearningState` format. The shared parser validates core profile/curriculum relationships, normalizes prerequisite ordering and completion, restores historical attempts, and discards damaged optional caches using the same compatibility rules as guest restoration. A single saved course remains bounded to 512 KiB; a track write body is bounded to 8 MiB. The existing AI endpoints keep their separate compact 64 KiB request limit.

`AccountTrackSummary` contains `id`, `revision`, `updatedAt`, `title`, `track`, `profileName`, `moduleCount`, and `completedModuleCount`. Listing paths reads metadata rather than downloading every course.

Each account can retain at most 100 paths. The server checks capacity inside the same write transaction as record creation, so simultaneous requests cannot exceed the limit. Capacity counts only that account's own records. A full account receives HTTP 409 with `TRACK_LIMIT` and can delete an unused path to free a slot. Existing idempotent import receipts are resolved before the capacity check, so retries continue to recover already saved progress when the account is full.

## Safe saves and guest imports

Updates use compare-and-swap revisions: the SQL update succeeds only when the stored revision matches the client's expected revision and the plan identity still matches the record. A competing save returns HTTP 409 without overwriting the winner. Deletion also checks its expected revision. Clients preserve unsaved work when a conflict occurs. Retrying in the UI saves that tab’s work as a separate recovered path, leaving the competing version intact. The message explains this before the learner retries.

Guest import keys are scoped to the account and recorded atomically with the new path. Retrying the same import after a lost response returns its original record. If the learner has since made progress there, the retry returns the newer revision and preserves that progress. Importing into a different account uses that account's independent key scope.

Account storage retains the existing client-side assessment model. It validates saved data relationships and keeps attempt snapshots with their grades. It does not introduce proctored assessment or a certification system.

## Verification

The offline integration suite uses actual native SQLite and scrypt with a disposable database:

```sh
node scripts/accounts.cjs
```

It covers credential storage, session rotation and expiry, private file permissions, owner isolation, revision races, account-switch protection, idempotent imports, progress/history restoration after reconnecting, payload bounds, and persistent login throttling.

The HTTP journey exercises the real Next.js routes with private cookie jars. Run it against an isolated mock server with a disposable database. The commands below preserve any configured live credentials by overriding them only for the test process:

```sh
OWNPATH_DIST_DIR=.next-account-test \
OWNPATH_DATABASE_PATH=/private/tmp/ownpath-account-journey.sqlite \
ANTHROPIC_API_KEY=YOUR_API_KEY_HERE \
AZURE_SPEECH_KEY= \
npm run dev -- --port 3006
```

Then, in another terminal:

```sh
BASE_URL=http://127.0.0.1:3006 node scripts/accounts-http.cjs
```

The HTTP script creates two uniquely named synthetic accounts and three paths, obtains real mock lessons and fresh five-question quizzes, saves completed attempt history, switches records, signs out and back in, and checks owner isolation, stale revisions, account-header mismatches, and import retries. It prints no passwords, cookies, or email addresses. All generation responses must report `mock`. The temporary database can be removed after stopping the isolated server.
