# Test suite — ExamPortal (Phase 0: environment, seeding, email mock)

> **Safety rules enforced by tooling**
>
> 1. Everything here targets a **staging/test database only**. `test:seed` and
>    `test:cleanup` **refuse to run** when `.env.test` points at the production
>    project referenced in `.env` (guard: `tests/lib/env.mjs`).
> 2. **No real email is ever sent**: the Resend SDK is redirected to a local
>    mock via `RESEND_BASE_URL` (a native resend >= v6 env override — zero
>    app-logic changes). All payloads are captured for assertions.
> 3. All seeded data carries the **`loadtest_` marker** (emails on the reserved
>    `loadtest.example` domain) and is removed by `test:cleanup`.
> 4. Secrets/plaintext test passwords live **only** in gitignored
>    `tests/.artifacts/` files — never print them, never commit them.

## One-time setup

```powershell
# 1. Create a staging/test database and apply migrations to it:
#    - fully local: keep TURSO_DATABASE_URL="file:./tests/.artifacts/test.db", then
$env:TURSO_DATABASE_URL="file:./tests/.artifacts/test.db"; npm run db:migrate
#    - or a staging Turso DB: turso db create prarambh-test, then point .env.test at it.
Copy-Item .env.test.example .env.test   # and fill in the staging URL/token

# 2. Verify tooling
npm run test:resend-selftest            # Resend mock: capture + failure injection
npm run test:seed -- --dry-run          # fixture plan, no database touched
```

## Everyday commands

| Command                             | What it does                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:test`                  | Starts the Resend mock + `vite dev` with `.env.test` (pins the port to `APP_URL`, writes `tests/.artifacts/dev-server.json`)                                                                  |
| `npm run test:seed`                 | Seeds 2 organizers, 5 exams (10/25/50/120/5 q), 318 students (`300` load students via `SEED_LOAD_STUDENTS`). Idempotent — re-running resets students to `not_started` and wipes their answers |
| `npm run test:seed -- --dry-run`    | Prints the plan + validates bcrypt, touches nothing                                                                                                                                           |
| `npm run test:cleanup`              | Deletes **only** `loadtest_`-marked data (manifest IDs first, marker sweep as safety net) and removes local artifacts                                                                         |
| `npm run test:cleanup -- --dry-run` | Counts what would be removed, deletes nothing                                                                                                                                                 |
| `npm run test:resend-mock`          | Runs the Resend mock standalone (port `RESEND_MOCK_PORT`, default 4599)                                                                                                                       |
| `npm run test:resend-selftest`      | 4-assertion self-test of the mock                                                                                                                                                             |

## Artifacts (gitignored — `tests/.artifacts/`)

| File                        | Contents                                                                      | Created by  |
| --------------------------- | ----------------------------------------------------------------------------- | ----------- |
| `loadtest-credentials.json` | Organizer + student plaintext passwords (**secret**)                          | `test:seed` |
| `loadtest-manifest.json`    | Exact IDs of seeded rows (used for exact cleanup)                             | `test:seed` |
| `resend-payloads.jsonl`     | Every email payload: recipient, name, roll no, password, exam name, exam link | Resend mock |
| `dev-server.json`           | `{ baseUrl, port, pid }` of the running dev server                            | `dev:test`  |

## Seed fixtures

| Exam slug                | Title                      | Qs                       | Minutes | Status/window                |
| ------------------------ | -------------------------- | ------------------------ | ------- | ---------------------------- |
| `loadtest-smoke-10q`     | loadtest_smoke 10q 15m     | 10 (incl. multi-correct) | 15      | live                         |
| `loadtest-standard-25q`  | loadtest_standard 25q 30m  | 25                       | 30      | live — **300 load students** |
| `loadtest-long-50q`      | loadtest_long 50q 45m      | 50                       | 45      | live                         |
| `loadtest-marathon-120q` | loadtest_marathon 120q 90m | 120                      | 90      | live                         |
| `loadtest-draft-5q`      | loadtest_draft 5q 10m      | 5                        | 10      | draft, starts in 30 days     |

Organizers: `loadtest_organizer@loadtest.example`, `loadtest_organizer2@loadtest.example`
(second organizer exists to test cross-organizer isolation). Student emails:
`loadtest_s001@loadtest.example` … `loadtest_s300@loadtest.example` (plus
`loadtest_p*` smoke, `loadtest_l*` long, `loadtest_m*` marathon, one Unicode
name in the smoke pool).

## Troubleshooting

| Symptom                                          | Fix                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `Missing .env.test`                              | `Copy-Item .env.test.example .env.test` and fill it in                    |
| `REFUSING TO RUN`                                | `.env.test` points at production — create a staging database              |
| `Cannot query the exams table`                   | Run `npm run db:migrate` against the staging/test database                |
| Bulk send says "Email sending is not configured" | Start the app via `npm run dev:test` (it sets the `RESEND_*` test values) |
| Port already in use                              | Free the port or change `APP_URL` (and its port) in `.env.test`           |
