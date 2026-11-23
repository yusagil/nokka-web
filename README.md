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
provider's own console or the admin inbox below. The public API has no listing endpoint; the admin API
requires authentication. Never log or screenshot real entries.

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

## Private install links

A person whose updates are allowed can get a full installer without any public download. In the admin inbox,
an allowed request's card has `비공개 설치 링크`: `설치 링크 만들기` issues a link valid for 72 hours
(`INSTALL_LINK_TTL_HOURS`), shows its address once, and opens a mail draft to the stored email
(`링크 메일 작성`, sent by the operator). Nothing is mailed automatically.

- Address: `https://nokka-web.vercel.app/install#<token>`. The secret is in the fragment, which browsers never send,
  so it is never in a request path, query string or referrer: the request fields that hosting logs (Vercel Runtime
  Logs and Log Drains) record. The `/install` page reads it, removes it from the address bar and history, and
  sends it once in a JSON body to `POST /api/updates/v1/install/session`. It does the same when another link is
  opened in the same tab (a fragment change, no reload): the previous download disappears first, and only the
  answer for the link opened last is shown. An open link answers with its `ref` (a random UUID that is not
  secret) and gets its own HttpOnly, Secure, `SameSite=Strict` cookie, `__Secure-nokka-install-<ref>`, scoped to
  `/api/updates/v1/install/<ref>` for the link's remaining lifetime.
- Download: the page's button is an ordinary link to that link's own `GET`/`HEAD
  /api/updates/v1/install/<ref>/Nokka.dmg`, so the browser's own download and its resume (`Range` with `If-Range`)
  work with that link's cookie. Links opened in several tabs never share a cookie: each tab downloads and resumes
  exactly the link and build it shows. The address only opens with the session of the link `ref`; the `ref` in
  logs opens nothing. Tools open the link with the same `POST` and send the cookie, or its value as
  `Authorization: Bearer`. Answers carry `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and
  `Content-Disposition: attachment`. A missing, malformed, unknown or other link's session (the link's own token
  included) gets 404, and a closed link 410; both clear that link's cookie. Refusals are short plain text without
  package bytes. The secret still travels in the mail itself, which is the delivery channel.
- Opens once: the first successful `POST /api/updates/v1/install/session` consumes the link's token and stores the
  SHA-256 of a new session secret, which the cookie carries instead of the token. Every later `POST` with that
  token, at the same time or after, gets 410 `USED` with no cookie but the same `ref` and package details as the
  first answer (nothing secret); a closed link answers a plain `GONE` first. The session keeps downloading and
  resuming until the link closes. The opening is one transaction that holds the link row and
  only then judges it, by what is committed and the clock at that moment, so concurrent openings, revocation,
  replacement and approval withdrawal take turns, an opening that waited past the expiry is refused, and a refused
  or failed opening (404, 410, 503) leaves the token unused for a retry. A page that lost the successful answer's
  body, or whose tab was refused because another tab of the same browser opened the link first, checks `HEAD` on
  the named download address with the browser's cookies: 200 means this browser holds the session and can download
  and resume. A browser without that session (another browser, or the cookie was lost too) gets 404 and needs a new
  link: the token never makes a second session. Links issued before migration 0008 can still be opened once;
  download cookies set before it carried the token and are refused (404) and cleared, so the link is opened again.
- Closing: one open link per request. A new link revokes the previous one, `링크 회수` (`DELETE` on the same admin
  path) revokes it, and withdrawing the approval revokes it for good: allowing updates again needs a new link.
  Expiry, revocation and withdrawal refuse every **new** request at once, including the session, `HEAD` and a
  resumed range. **A response that is already sending bytes is not cut off and can finish**; the next request is
  refused. The database keeps only the token's and the session's SHA-256, the build, the times and a download
  count (no addresses).
- Installer: `node scripts/update-packages.mjs installer --build <N|none>` chooses what new links serve. It can be
  the verified bridge build (stage it with its manifest; it is never published) or a published build. Withdrawing
  or rolling back that build clears the choice and closes its links. `status` shows it as `install links`.
- API: `POST`/`DELETE /api/admin/applications/:id/install-link`, with the same admin checks as the inbox API.
  `POST` answers 409 `UPDATES_NOT_APPROVED` or `NO_INSTALLER` when no link can be issued.
- Code: `src/lib/update-packages/install-{contracts,handlers,links}.ts`, `src/app/install`,
  `src/components/install/InstallLinkPage.tsx`, `src/components/admin/InstallLinkPanel.tsx`, migrations 0007 and
  0008. `install-links.integration.test.ts` runs on Postgres with `APPLICATIONS_TEST_DATABASE_URL`. It covers
  issuing, downloads over local HTTP, two links open in one browser, replacement, revocation (including a download
  already under way), expiry, approval and package withdrawal, opening once (many openings at once, a revocation,
  expiry or approval withdrawal while an opening waits, a failed opening retried, a lost first answer with and
  without its cookie, resumes until expiry, links issued before 0008), and checks that no request line carried a
  secret.
- Before release, check on an isolated Preview with a synthetic link: open it, download in full and resumed, open
  it again (410 `USED`), and confirm that neither the Runtime Logs nor an active Log Drain contain the token or the
  session secret.

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

## Release and QA runbook

For agents and maintainers releasing `yusagil/nokka-web`. Run commands from this web repository, not the
macOS app repository. This procedure does not grant deployment, account, environment or mail permissions:
reuse approval already given for the release; obtain any missing approval before the affected action.
In particular, merging into `main` triggers a public Production deployment.

### 1. Identify the release and prepare its environment

Confirm the checkout and `origin` belong to `yusagil/nokka-web`, then record the branch, full candidate SHA,
base SHA and intended files. Inspect remote configuration privately; do not print credentials embedded in URLs.

```bash
git fetch origin
git status --short --branch
git branch --show-current
git rev-parse HEAD origin/main
git diff --name-status
git diff --cached --name-status
git diff --name-status origin/main...HEAD
git diff --check
git diff --cached --check
git diff --check origin/main...HEAD
```

Review both committed and uncommitted changes. Preserve unrelated work; stop on an unexpected repository,
divergence or unexplained changes. Use a topic branch based on the current `origin/main`; do not publish
directly to `main`. Review and commit only the intended files before recording the candidate SHA for the
checks below; a dirty worktree is not evidence for that SHA. Resolve conflicts and revalidate before
proceeding. Check existing GitHub/Vercel sign-in
and access to the intended project (`yusagils-projects/nokka-web`), Git connection, Production Branch `main`
and canonical domain `https://nokka-web.vercel.app`.

Use `.env.example` as the settings checklist, checking names and target environments without displaying
values. Next.js reads `.env.local`; a file pointing at production makes local form submissions write to
production. Use a disposable database for local/Preview QA and a separate direct, non-pooled connection
in `APPLICATIONS_TEST_DATABASE_URL` for integration tests. Export test settings securely into the test
process; Vitest does not load `.env.local` through this project's configuration. Never use the production
database as the test database. Match the configured Vercel Node.js version and record Node/npm versions.

For browser QA, confirm the database migrations, rate-limit secret, allowed origin, `BETTER_AUTH_URL`,
GitHub OAuth callback and allowed numeric GitHub id match that environment. `next dev` accepts localhost
origins; `next start` and Preview require their exact origin in `APPLICATION_ALLOWED_ORIGINS`.
Production settings are not evidence that Preview settings exist. Missing settings or OAuth access are
blockers for the affected checks, even if a Preview build succeeds. Do not copy production secrets into
Preview or create/change accounts, OAuth apps or hosting settings just to make QA pass.

Keep tokens, cookies, OAuth codes, connection strings, personal emails, applicant data and local absolute
paths out of terminal output, screenshots, PRs and commits. Never commit `.env.local`, `.vercel` or QA data.

### 2. Run the pre-deployment checks

For code, dependency, configuration or migration changes, run the commands below in order, stopping at
the first failure. Load the disposable test DB setting before the test command; otherwise all three
Postgres integration suites skip, which is not a full pass.

```bash
node --version
npm --version
npm ci
npm run lint
npx --no-install tsc --noEmit
npm run test:run
npm run build
```

There is no `typecheck` or browser-QA script in `package.json`; use the TypeScript command above and the
browser checks below. Record actual passed/failed/skipped test counts. When preparing the isolated app
database or testing a new migration, securely export its `DATABASE_URL`, then run `npm run db:migrate`.
The migration command reads process environment, not `.env.local` automatically. A second run must report
`No pending migrations.` Production migrations need the release's explicit scope/approval and must be
compatible with the still-running version; do not run them merely as a smoke test.

Reuse an earlier successful check only when its full candidate SHA, dependencies, configuration,
environment and coverage still match and its evidence is available. A changed candidate or relevant
environment invalidates affected results. For a **README-only change**, verify that only `README.md`
differs, review its commands/paths/expected responses against source, and run `git diff --check` (also
`git diff --cached --check` after staging and `git diff --check origin/main...HEAD` for committed changes). Full tests, lint, typecheck and local build need not repeat
when the unchanged code's successful baseline is documented. Record that baseline SHA separately from
the new documentation SHA. Still require this PR's Preview build and the final Production checks below;
do not label inherited functional evidence as a new test run. No new CI workflow is required by this guide.

### 3. Check the browser flow before merging

For code changes, use an isolated local/Preview environment with the candidate code. Check `/ko` and `/en`
at desktop **1440 × 1000** and mobile **390 × 844** (four views). In every view verify the visible request
CTA reaches `#apply`, name/email labels and validation work, keyboard focus is usable, language links and
section links work where shown, and content has no overlap or horizontal overflow. Desktop navigation
and its CTA are intentionally hidden on mobile; the hero CTA remains available. Confirm there are no
DMG/download buttons or GitHub Releases download links in the rendered page. Capture public/synthetic
screens only. Use the same matrix again on the canonical site after a code deployment.

Test one new application and one duplicate using the synthetic-data procedure below. Both must produce
HTTP `200 {ok:true}` and the localized success UI. HTTP success alone is insufficient: verify exactly one
stored row and preservation of the first name and original metadata after the duplicate. Check empty and
invalid fields without creating data. Investigate errors instead of repeatedly submitting or exhausting
the production rate limit.

For admin QA, use the allowed user's real GitHub login and the OAuth app configured for that environment:
visit `/admin/applications` signed out, follow `/admin/login`, sign in, search for only the synthetic
identifier, and expect search HTTP 200. Search text must not appear in the URL. Refresh, visit a public
page and return; the session must remain valid. When changing auth/dev startup behavior, also restart
the local dev server with the same DB/settings and verify the existing session works on its first request.
Sign out of Nokka, then confirm search returns 401 and revisiting the inbox redirects to login.
Do not sign out of GitHub or delete the admin account. Fixtures do not replace real OAuth verification.
The user handles passwords, MFA, security challenges or new consent when required; report the unverified
step if authentication is unavailable. Never switch to another person's account or expand permissions.

### 4. Open the PR, merge and identify Production

1. Confirm the candidate commit contains only the intended files and the worktree is clean. Record the
   full SHA and push the topic branch normally. Additional edits require a new commit and affected checks
   before pushing. For this repository's review flow, open a GitHub PR with base `main`,
   the exact head branch, an accurate change description, validation evidence and any remaining user QA.
   GitHub's PR UI is sufficient; if the branch has no difference from `main`, report that and do not create
   an empty commit or reapply existing changes to manufacture a PR.
2. In the PR's **Checks** and Vercel deployment link, wait for all applicable checks and the **Preview**
   build to succeed for that exact head SHA. Open the Preview through the user's authorized Vercel session
   if deployment protection requires it. Verify its environment before functional testing; a Vercel SSO
   redirect is deployment protection, not the app's admin-login check. Do not disable protection.
3. Recheck the PR head, base, review requirements and validation scope. If code or the merge result changes,
   run the affected checks before merge. With release approval already in scope, use GitHub's normal
   **Create a merge commit** flow; otherwise obtain approval now, with the reviewed PR and checks ready.
   Do not bypass required checks, force-push or change repository rules. Record the PR URL and merge SHA.
4. Let the existing Git integration deploy `main` automatically. In Vercel's project **Deployments**, open
   the **Production** deployment for the merge SHA and wait for **Ready** (`READY` in the API). Verify the
   full source SHA, target environment, deployment ID/URL, build result and the canonical domain's assignment
   to that deployment. The PR's Preview success is not Production success. If another commit has advanced
   `main`, identify the exact deployed revision and its coverage; do not attribute it to the earlier QA.
5. Check `https://nokka-web.vercel.app` directly. A protected deployment-specific URL alone cannot prove
   the public domain serves the intended build. If the automatic deployment is missing, failed or serves
   the wrong SHA, stop and report it; a manual production deploy or rollback needs approval for that action.

Do not assume fixed required-check counts or old deployment IDs. Use the current PR/project state and
record what actually ran; this procedure neither creates CI nor grants standing deployment permission.

### 5. Check the deployed site without sending mail

Run the following smoke requests against the verified canonical deployment **without cookies**, and do
not follow redirects automatically. Inspect both status and JSON where specified. All JSON failures below
have `ok:false`. Confirm the negative-test origin (`https://example.com`) is not allowlisted.
The public invalid-input checks stop before storage/rate limiting; the admin PATCH uses
an invalid identifier and body as an extra safeguard. These checks create no application or email.

| Request | Headers/body | Expected result |
| --- | --- | --- |
| `GET /` | `Accept-Language: ko` | 307 redirect to `/ko` |
| `GET /ko` and `GET /en` | None | Both 200; request form present, no download entry point |
| `GET /admin/login` | None | 200; GitHub login available, no unavailable message |
| `GET /admin/applications` | None | 307 redirect to `/admin/login` |
| `GET /api/auth/get-session` | None | 200 with JSON `null` |
| `POST /api/admin/applications/search` | Canonical `Origin`, JSON `{}`, `X-Admin-Request: 1` | 401, `code: "UNAUTHENTICATED"` |
| `PATCH /api/admin/applications/qa-probe` | Canonical `Origin`, JSON `{}`, `X-Admin-Request: 1` | 401, `code: "UNAUTHENTICATED"` |
| `GET /api/cron/application-digest` | No authorization | 401, `code: "UNAUTHENTICATED"` |
| `GET /api/cron/application-digest` | `Authorization: Bearer invalid-qa-token` | 401, `code: "UNAUTHENTICATED"` |
| `POST /api/applications` | `Origin: https://example.com`, JSON `{}` | 403, `code: "FORBIDDEN"` |
| `POST /api/applications` | Canonical `Origin`, JSON `{}` | 400, `code: "INVALID_REQUEST"` |
| `POST /api/applications` | Canonical `Origin`, JSON `{"name":"","email":"invalid"}` | 400, `code: "VALIDATION_ERROR"`; name `REQUIRED`, email `INVALID` |

There are 13 requests in this matrix (the locale row contains two). For example, use curl without its
default config or a cookie jar, repeating with the methods/headers/bodies above:

```bash
qa_base=https://nokka-web.vercel.app
curl -q -sS --max-time 20 -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  "$qa_base/admin/applications"
curl -q -sS --max-time 20 -w '\nHTTP %{http_code}\n' \
  -H "Origin: $qa_base" -H 'Content-Type: application/json' \
  --data '{}' "$qa_base/api/applications"
```

An admin/auth 503, or an admin redirect with `error=unavailable`, is a configuration/database failure,
not a successful protection check. An unauthenticated Cron 503 means `CRON_SECRET` is absent or invalid.
A Cron 401 proves only its authorization gate, not Gmail configuration or delivery. Stop on unexpected
results; do not make a valid application submission to diagnose storage without the safeguards below.

In Vercel, inspect the current project's Cron registration: `/api/cron/application-digest`, schedule
`0 0 * * *` UTC, enabled/Active and associated with the intended Production deployment. Check the actual
schedule and invocation state; on Hobby allow the 09:00–09:59 KST execution window. **Do not press Run or
call Cron with the real secret during routine QA**: it may send mail and change digest state. Registration,
an invocation, provider acceptance and actual receipt are separate evidence. A mail-delivery test needs
explicit authorization, an isolated database and the authorized sender/recipient; record acceptance and
inbox receipt separately. Never infer scheduled delivery from a protected-route check.

After a code deployment, repeat the four public views and real admin login/search/session/logout flow
on Production. A README-only deployment can reuse unchanged-code browser/OAuth evidence with its source
SHA and environment noted; still verify the new deployment/domain, smoke matrix and Cron registration.

### 6. Handle synthetic applications and record completion

Prefer the isolated environment for all submissions. For a production new/duplicate test, first confirm
the release's QA scope permits it and arrange the database operator's immediate verification and cleanup.
Use a fresh identifier such as `nokka-qa-<UTC-timestamp>-<random>@example.com` and a clearly synthetic name;
confirm the normalized email does not already exist. Never use a real applicant or personal email.

Before submitting publicly, check the current Cron schedule and that no invocation is active or planned
manually. Do not test during 09:00–09:59 KST. Agree a cleanup deadline before the earliest scheduled run,
with enough margin to verify that no test rows remain. After the window, confirm the invocation has finished. If isolation or
enough safe time for cleanup cannot be secured, stop the submission test and report it as blocked. Do not
disable Cron or change the digest schedule to make room for QA.

Submit once with the first synthetic name and have the operator note that row's original metadata privately.
Then reload the form and submit the same email (optionally
with changed case/outer spaces) with a different synthetic name. Verify both responses and success UI,
then have the operator check the exact normalized email: one row, the first name, and unchanged original
timestamps/status/note. Record its ID privately for cleanup; do not export the application list. Do not
delete between the two submissions. If either submission or later QA fails, stop further requests and
immediately arrange cleanup of any test row already created.

Immediately remove only that verified QA row, matching its ID, normalized email and original synthetic
name, after checking it has no digest item. Recheck that the exact test email has zero rows. If a digest
has already claimed it, stop and report instead of deleting digest history or changing a batch's count.
Remove a rate-limit row only if its exact HMAC key, window and count establish that this run created it
and no other traffic shares it; otherwise leave it to expire and report why. Never clear a whole table,
delete real applications, reset shared rate limits or remove `auth_*` account/session rows as cleanup.
Use the private database operator workflow; do not put production SQL, connection details or secrets in
the README, PR or QA report. Remove only temporary files/processes created for this QA.

Finish with a short release record in the PR or approved work log: repo/branch, candidate and merge/deployed
SHAs, PR URL, Preview/Production URLs and status, canonical domain, checks with passed/failed/skipped counts,
the four views, OAuth coverage, synthetic submissions and cleanup counts, Cron status, and remaining issues.
Distinguish newly executed checks from reused evidence and deliberately untested mail delivery. A failure
or missing prerequisite stops the dependent stage; report the exact step and impact. Recover or roll back
only within explicit approval, then verify the recovered deployment. Never mark a step complete merely
because it was performed for an earlier release.
