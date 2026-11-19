# nokka-web

Landing page for [Nokka](https://nokka-web.vercel.app), a meeting recorder for macOS. Next.js (App Router) with
`/en` and `/ko`, deployed on Vercel from `main`.

## Development

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit
npm run test:run   # vitest
npm run build
```

Read `AGENTS.md` first: this Next.js version differs from older ones (for example `src/proxy.ts` instead of
middleware).

## Content

- Copy lives in `src/dictionaries/en.json` and `ko.json`. Both must have the same structure
  (`src/dictionaries/__tests__/dictionaries.test.ts` checks this, and that the copy makes no blanket
  "100% local / no cloud" claims). Product facts come from the Nokka app repository's README and CHANGELOG.
- App screens in `public/screens/` are renders from the app's preview tests with sample conversations.
  Do not use screenshots of real recordings.
- Design tokens are in `src/app/globals.css` (`@theme`), following `DESIGN_REQUIREMENTS.md`.

## Access requests

The `#apply` form posts `{name, email}` to `POST /api/applications`
(`src/app/api/applications/route.ts`). The request/response contract and the shared validation live in
`src/lib/applications/contracts.ts` and `validation.ts`, the only files there that client code may import.
The API answers `200 {ok:true}` only after the row is committed in Postgres, or an earlier row with the same
trimmed, lower-cased email is confirmed. That earlier row is never changed. Every failure answers
`{ok:false, code}`, and an unconfigured or unreachable database gives `503 UNAVAILABLE`.

Server-only settings (see `.env.example`): `DATABASE_URL`, `APPLICATION_RATE_LIMIT_SECRET`, and optionally
`APPLICATION_ALLOWED_ORIGINS`. Requests need an allowed `Origin` (the public site, configured origins, and
`http://localhost:*` in `next dev`). Each client IP gets 10 stored requests per 10 minutes. The rate limiter
keeps a counter keyed by an HMAC of the IP in the same database and deletes finished windows.

Setting up a database:

```bash
DATABASE_URL=... npm run db:migrate   # applies db/migrations/*.sql once each
```

Applied files are recorded in `schema_migrations` and never run again. Do not edit an applied migration; add a
new numbered file instead (0001-0003 are applied to the production database).

Run migrations and the server with the same owning role. Row level security is on with no policies, so hosted
data APIs (for example Supabase's `anon` key) cannot read the list. View the list with the database
provider's own console. The site has no endpoint that lists requests. Never log or screenshot real entries.

Integration tests need a disposable Postgres database. They create and drop their own schema and use
synthetic data only:

```bash
APPLICATIONS_TEST_DATABASE_URL=postgres://... npm run test:run
```

## Admin inbox

`/admin/applications` is a Korean-only, private inbox for the request list: search, status
(`new`/`hold`/`contacted`), a short note, and a mail draft link. Only one GitHub account gets in.

- Sign-in: Better Auth (`better-auth`, GitHub OAuth, sessions in Postgres). `src/lib/admin/better-auth.ts`
  turns away any GitHub id other than `ADMIN_GITHUB_USER_ID` before a user row is written. It also refuses
  sessions for anyone else. `getAdminSession()` in `src/lib/admin/session.ts` checks the session and
  linked GitHub id again on every page load (`src/app/admin/applications/layout.tsx`) and API call.
  Missing settings fail closed: login and the API answer 503.
- API: `POST /api/admin/applications/search` (search terms stay out of URLs and logs) and
  `PATCH /api/admin/applications/:id`. The contract is in `src/lib/admin/contracts.ts`. Requests need the
  admin session, `Origin` equal to `BETTER_AUTH_URL`, JSON, and `X-Admin-Request: 1`. Saves compare
  `updatedAt` and answer 409 when the row changed in between. Only a change to `contacted` records
  `lastContactedAt`. A repeated public request for the same email changes nothing.
- Setup: run `npm run db:migrate` (0002 adds the inbox columns and the `auth_*` tables). Then set the
  settings listed in `.env.example`. Register one GitHub OAuth App per environment with callback
  `{BETTER_AUTH_URL}/api/auth/callback/github`.
- Tests: `src/lib/admin/__tests__/admin.integration.test.ts` runs with `APPLICATIONS_TEST_DATABASE_URL`, like
  the other integration tests. It covers paging, search, saves and real Better Auth session checks.

## Daily digest

Vercel Cron calls `GET /api/cron/application-digest` once a day (`vercel.json`: `0 0 * * *` UTC, 09:00 KST).
On the Hobby plan the call can come any time between 09:00 and 09:59. Cron runs only on production deployments.
The request must carry `Authorization: Bearer <CRON_SECRET>`.

- Content: only the number of new requests and a link to `/admin/applications`, which needs sign-in. No names,
  emails or notes. When there are no new requests, nothing is sent. Each request is counted in one digest only.
- Mail: sent with the Gmail API from the connected account (`APPLICATION_DIGEST_FROM`, using
  `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN`). It always goes to the one recipient in
  `APPLICATION_DIGEST_TO`, which stays out of the source. Missing settings answer 503 and send nothing.
- Failures: a refused, failed or uncertain send is retried automatically on the next day's call with the same
  batch (same count), without operator SQL. Each batch gets at most one send attempt per Asia/Seoul day, also
  across repeated or concurrent calls. Token refresh errors are retried within the call and send nothing. Gmail
  has no idempotency key, so when an uncertain send did arrive, the next day's retry delivers the same notice once
  more. A revoked or expired refresh token is recorded as a failure (never as sent) until consent is renewed.
  Delivery is not exactly-once, and Vercel Cron itself does not retry.
- Code: `src/lib/notifications/**`, table `application_digest_runs`/`application_digest_items` (migration 0003).

## Download link

The site has no download button or link to GitHub Releases for now. Releases themselves are unchanged; the app's
update check still reads them. Build numbers and SHA-256 checksums belong in the release notes, not on the site.
