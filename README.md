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
new numbered file instead (0001-0003 are applied to the production database). Runners started together, even
on an empty database, take turns, so each file still runs once.

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
(`new`/`hold`/`contacted`), a short note, update approval, and mail draft links. Only one GitHub account gets in.
An opened card also shows where the request stands after the approval, each read separately: the latest approval
mail (see below), whether a Mac is registered for updates (never which one), and the latest one-time code mail the
app asked for (when, and how the mail service answered; never the code). `contacted` stays the operator's own
record and is never set by a mail.

- Sign-in: Better Auth (`better-auth`, GitHub OAuth, sessions in Postgres). `src/lib/admin/better-auth.ts`
  turns away any GitHub id other than `ADMIN_GITHUB_USER_ID` before a user row is written. It also refuses
  sessions for anyone else. `getAdminSession()` in `src/lib/admin/session.ts` checks the session and
  linked GitHub id again on every page load (`src/app/admin/applications/layout.tsx`) and API call.
  Missing settings fail closed: login and the API answer 503.
- API: `POST /api/admin/applications/search` (search terms stay out of URLs and logs),
  `PATCH /api/admin/applications/:id` and `POST /api/admin/applications/:id/approval-mail`. The contract is in
  `src/lib/admin/contracts.ts`. Requests need the admin session, `Origin` equal to `BETTER_AUTH_URL`, JSON, and
  `X-Admin-Request: 1`. Saves compare `updatedAt` and answer 409 when the row changed in between. Only a change to
  `contacted` records `lastContactedAt`. A repeated public request for the same email changes nothing.
- Withdrawing the approval (saving it off) ends the registered Mac's updates, every unused code, the open install
  link and an approval mail not yet handed to the mail service, in one transaction. The card says so before saving.
- Mail drafts: each draft opens from two links with the same recipient and subject. `Gmail로 …` opens Gmail's
  web compose window (`https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…`) in a new tab of the same browser, in
  the Google account signed in there by default, so it needs no mail app and the admin page stays open.
  `메일 앱으로 …` is a `mailto:` link: it works only when the browser or macOS passes it to a mail app, and the
  page can't tell when nothing takes it. Neither sends anything. The request draft also fills its short body. The
  install-link draft never puts the link in an address (no `body` in either link), so it stays out of mailto:
  handlers, Gmail's request and the browser's history: `메일 본문 복사` copies the body with the link and its expiry
  to paste in. When the clipboard refuses it, the whole body appears in a read-only field, selected to copy by hand.
  Both copy buttons do nothing while a new link or a revoke is under way, and while an earlier copy is still being
  written (clipboard writes can finish out of order, so an old link's could land last). A copy that ends after a
  request began reports nothing, and a new link says that anything copied with the old one no longer works.
- Setup: run `npm run db:migrate` (0002 adds the inbox columns and the `auth_*` tables). Then set the
  settings listed in `.env.example`. Register one GitHub OAuth App per environment with callback
  `{BETTER_AUTH_URL}/api/auth/callback/github`.
- Tests: `src/lib/admin/__tests__/admin.integration.test.ts` runs with `APPLICATIONS_TEST_DATABASE_URL`, like
  the other integration tests. It covers paging, search, saves and real Better Auth session checks.

## Approval mail

Saving `업데이트 허용` on (off → on) sends the person one mail with a new private install link (see below) and the
steps after it: press `설치 파일 받기` once on the Mac to install, then request the 8-digit code in the app's
registration screen. The code itself is still mailed only when the app asks for it; people who already have Nokka
start at that step. Korean first, English below, sent with the Gmail API from `UPDATE_CODE_MAIL_FROM` to the
request's stored email (`src/lib/notifications/approval-mail.ts`).

- One mail per approval: the save stores one row in `approval_mails` in the same transaction as the change (unique
  per request and approval generation). Saving the same value again, a note, a 409 retry or two saves at once
  store none. Requests allowed before migration 0009 get no mail until the operator sends one.
- Sending (`src/lib/admin/approval-mail{,-store}.ts`): after the commit, the save claims the row and makes one
  attempt before answering, so the card shows the result at once. An attempt gets mail access first, then, holding
  the request row, checks that it still owns the request's latest mail and that updates are still allowed, and
  issues the link (replacing the open one). It records and commits that it is about to ask the mail service, then
  makes the one request and records the answer for its own attempt only (a stalled attempt can not write over a
  newer one). The link's token is only in that attempt's memory and in the mail; the database keeps its SHA-256.
- Results, shown on the card: `accepted` (the mail service took it, not proof of delivery), `rejected` (nothing
  sent; its link is closed), `uncertain` (no answer, or the answer was never recorded: it may have been sent),
  `failed` (stopped before asking: no installer, the installer withdrawn after the link was made, mail not
  configured, mail access refused; nothing sent, the approval stays), `cancelled` (the approval was withdrawn, the
  link revoked or replaced by a link made by hand before it was sent) and, derived after two minutes,
  `interrupted` (never asked: claimed or stored and then left). Right before asking, the attempt checks again,
  holding the request and channel rows, that the approval, its link and the link's package still stand.
- Never sent twice by itself: Gmail has no idempotency key, so a mail whose start was recorded is never asked for
  again automatically. The daily recovery run (`GET /api/cron/approval-mails`, 00:30 UTC, `CRON_SECRET`) only sends
  mails that never reached that point. It claims them one at a time and only while one more attempt (two Gmail
  requests of at most 8 seconds each, plus the database) fits in 50 of its 60 seconds, so the rest stay claimable
  by the next run or the operator. An attempt that waited for its rows until the send (and its record) no longer
  fits hands the mail back unsent, claimable at once by the next run. It answers 503 and claims nothing without
  mail settings.
- Finding who needs a link: a closed card of an allowed request shows its mail's state beside the badges
  (`승인 메일 없음`, `설치 링크 만료`, `설치 링크로 받음`, `승인 메일 안 감`, …), and an opened card says what the mailed
  link is now (not downloaded yet and until when, downloaded, expired, closed). These are read from the link's own
  row; nothing new is stored.
- Sending a new link is per request, chosen by the operator; there is no bulk send and no limit on how often.
  A request allowed before approval mails has none: `새 설치 링크 메일 보내기` sends its first one. After a mail whose
  link expired, was downloaded or was closed, `새 링크로 다시 보내기` sends a new one at once; while the mailed link
  still works (or the mail is uncertain), `승인 메일 다시 보내기` asks for a confirmation first. Every new mail
  carries a new link that downloads once and closes the previous link (an old or expired one included).
- The operator's button (`POST …/approval-mail` with `{expectedMailId, intent}`): `승인 메일 지금 보내기` (`send`) for a
  waiting or interrupted mail or none yet; `승인 메일 다시 보내기` (`resend`) after a finished one, with a confirmation
  when it may already have arrived. A resend is a new mail with a new link, which closes the previous link. A card
  that is out of date (another tab, the recovery run, a repeated request) gets 409 and sends nothing.
- A withdrawal and a mail already handed to the mail service can overlap: that mail then carries a link that no
  longer opens. Revoking the link or making one by hand cancels a mail not yet sent; those actions answer with the
  request's progress, so the card shows it. A link made by hand stops being offered on the card (address, copy
  buttons) once an approval mail sent after it replaced it. A card makes one link change at a time (a link by hand,
  its revocation, an approval mail), so a late answer of one never lands over the other. Mail and link answers
  update only the progress of the list's row as it is when they arrive (the newer mail and code mail win, and a
  mailed link already seen closed, downloaded or expired never reads as open again), never
  its version, status, note or approval: drafts survive, a save that ended meanwhile stays, and a later save still
  meets a change made elsewhere as a conflict.
- Tests: `src/lib/admin/__tests__/approval-mail.test.ts` (attempt order, handlers, recovery route, mail content)
  and `approval-mail.integration.test.ts` on Postgres with an in-memory sender: one mail per approval, concurrent
  saves and presses, withdrawal and re-approval, a stalled earlier attempt, a link made by hand or revoked, no
  installer, an interrupted or lost save, a lost answer, refused and uncertain answers, the admin guard and the
  card's read-only progress fields.

## Private install links

A person whose updates are allowed can get a full installer without any public download. Saving an approval mails
a new link to the stored email by itself (see [Approval mail](#approval-mail)). In the admin inbox, an allowed
request's card also has `비공개 설치 링크` for handing a link over again or recovering: `설치 링크 만들기` issues a
link valid for 72 hours (`INSTALL_LINK_TTL_HOURS`) and shows its address once, and cancels an approval mail not yet
handed to the mail service (its link would replace this one). `메일 본문 복사` copies the mail's body with the link,
and `Gmail로 링크 메일 작성` or `메일 앱으로 링크 메일 작성` opens a draft to the stored email with only the recipient
and subject, for the operator to paste the body in and send.

- Address: `https://nokka-web.vercel.app/install#<token>`. The secret is in the fragment, which browsers never send,
  so it is never in a request path, query string or referrer: the request fields that hosting logs (Vercel Runtime
  Logs and Log Drains) record. The `/install` page reads it, removes it from the address bar and at once loads
  `/install` again with `location.replace`, handing the token over in `window.name` (kept by the tab across a
  same-origin load, never sent or stored by the browser) with a `sessionStorage` marker that proves this tab sent
  it. Chromium keeps the address a tab opened, fragment included, in that history entry (`userTypedURL`) even
  after `history.replaceState`; the entry that replaces it does not have it. A tab that can not store the marker,
  or a browser that once lost a handed-over token, keeps the link in place instead, and that entry keeps the
  address. Another link opened in the same tab (a fragment change) leaves its entry the same way; the previous
  download disappears first, and only the link opened last is shown. The browser's own records of the address it
  opened (its history database) still hold the link, as for any link. A prerendered page waits until it is shown.
- The button uses the link, not the page: loading, reloading or previewing `/install` sends nothing, so a mail
  scanner or preview that runs the page leaves the link unused. `설치 파일 받기` sends the token once in a JSON body,
  `POST /api/updates/v1/install/session` with `{ "token": …, "action": "download" }`, and at once starts the
  download of the link's own address with the cookie that answer set. The token stays only in the page's memory
  while the button can be pressed (or pressed again after a failure). A reload, back or forward shows what the
  entry last showed from its own history state (`ref`, build and expiry, nothing secret): before the button, a
  request to open the link from the mail again (the token is gone with the document; it was not used); a download
  only once a `HEAD` of its address still answers 200 with this browser's cookie (no button while it is asked).
  Shown again, a link sent once whose `HEAD` answers 200 has not been sent yet: the page says so and offers
  `설치 파일 받기` again, never starting it by itself; right after a press it only says the browser was asked to
  download. A tab opened from this one, which copies its `sessionStorage` but
  not its entries, never shows it. Pages from before the button kept each opened link under the SHA-256 of its
  token in `localStorage`; the page removes those keys.
- Opens once: the first successful button `POST` consumes the link's token and stores the SHA-256 of a new session
  secret, which the link's HttpOnly, Secure, `SameSite=Strict` cookie `__Secure-nokka-install-<ref>` (scoped to
  `/api/updates/v1/install/<ref>` for the link's remaining lifetime) carries instead of the token. Every later
  `POST` with that token, at the same time or after, gets 410 `USED` with no cookie but the same `ref` and package
  details (nothing secret); a closed link answers a plain `GONE` first. The page then checks `HEAD` on the named
  address with this browser's cookies: 200 means this browser holds the session and has not received the package
  yet (another tab pressed first, or the first answer's body was lost), so it downloads; 404 means another browser
  pressed first (`이미 사용되었습니다`); 410 means it was sent here already or the link closed. The opening is one
  transaction that holds the link row and judges it by what is committed and the clock at that moment, so
  concurrent presses, revocation, replacement and approval withdrawal take turns, and a refused or failed opening
  (404, 409, 410, 503) leaves the token unused.
- Sent once: links issued since migration 0009 (`single_transfer`) send their package once, whole. Answers say
  `Accept-Ranges: none` and a satisfiable `Range` gets the whole file (200): a part of a DMG installs nothing.
  `HEAD`, 304 and a range not satisfiable as sent (416, also behind an `If-Range` that no longer matches) take
  nothing. A `GET` reads the package's first chunk, then takes the link's one transfer in a transaction that holds
  the link row and shares the package row (the release tool updates it to withdraw the package, so the two take
  turns), and judges expiry, revocation, approval and package in the one statement that takes it, by the clock at
  that moment (`transfer_started_at`, counted as the download); only then is the status line sent. A transfer
  taken by a concurrent request, a link closed meanwhile or a failure to record it sends no byte of the package
  (410 `USED`, 410 `GONE` or 503; the prepared chunk is dropped). A request whose client went away
  (`request.signal`) before the transfer is committed takes nothing (499). On Vercel that signal is only aborted
  for functions that opt in: `vercel.json` sets `supportsCancellation` for the download route alone
  (`src/app/api/updates/v1/install/*/Nokka.dmg/route.ts`; `*` because a glob reads `[ref]` as a character class,
  and a test checks that it matches that route and no other). Vercel then also ends the function when its client
  goes away; a response already sending bytes has nobody left to send them to. Without it a request cancelled while
  its first chunk was read or while it waited for the link row could still take the transfer. Shown again with
  its address unreachable (offline, 503), a link sent once is shown as not checked, with `다시 확인`: never as
  not sent, since a download may have taken it. Every later request, the
  same browser's resume included, gets 410 `USED`: a download cut off needs a new link, which the page and the
  refusal say (reply to the mail). Whether the DMG was then installed, or installed again from the file, is not
  something the site can see.
- Rolling back: links sent once keep their token's and session's SHA-256 under a key of their own (`onceKey`),
  while versions before 0009 look links up by the plain SHA-256 only. So a rollback never serves them by the
  earlier rules: there they open nothing (the page says the link can't be used, the download answers 404). A link
  nobody opened works again, by its own rules, once this version is back. **A link already opened may not:** the
  earlier version answers that browser's download request (a reload of the page that shows it asks with a `HEAD`,
  as does a download) with 404 and clears its cookie (`Max-Age=0`), and the token is used, so back on this version
  that browser gets 404 for the download and 410 `USED` for the button and needs a new link. Expect to reissue
  links (or resend the approval mail) to whoever opened one before or during the rollback and has not received the
  installer; a browser that kept its cookie still downloads once. During a rollback the earlier admin panel issues
  links by the earlier rules (opened as the page loads, downloaded until they close); after rolling forward those
  keep those rules until they close (72 hours at most), unless the operator revokes them or issues new ones.
  Migration 0009 goes first (its default keeps links the earlier version issues by the earlier rules), then this
  version; nothing has to be switched on in between.
- Earlier links keep their rules. Links issued before 0009 (`single_transfer` false, the column's default, so a
  link the previous version issues while the migration is ahead of it stays such a link) open with the token alone,
  as the page before the button sent it, and their session downloads and resumes (`Range` with `If-Range`, 206)
  until the link closes; a session opened before 0009 keeps working. A link issued since 0009 opened without
  `action` (a page from before the button, which opens links as soon as it loads) gets 409 `BUTTON_REQUIRED` and
  stays unused. Links issued before migration 0008 can still be opened once; download cookies set before it
  carried the token and are refused (404) and cleared.
- Download: `GET`/`HEAD /api/updates/v1/install/<ref>/Nokka.dmg`, only with the session of the link `ref`; the
  `ref` in logs opens nothing. Tools open the link with the same `POST` and send the cookie, or its value as
  `Authorization: Bearer`. Answers carry `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and
  `Content-Disposition: attachment`. A missing, malformed, unknown or other link's session (the link's own token
  included) gets 404, and a closed or (sent once) already sent link 410; both clear that link's cookie. Refusals
  are short plain text without package bytes. The secret still travels in the mail itself, which is the delivery
  channel.
- Closing: one open link per request. A new link revokes the previous one, `링크 회수` (`DELETE` on the same admin
  path) revokes it and cancels the request's approval mails not yet handed to the mail service (so no later run
  sends them with a new link), and withdrawing the approval revokes it for good: allowing updates again mails a new
  link. Expiry, revocation and withdrawal refuse every **new** request at once, including the session, `HEAD` and
  a resumed range. **A response that is already sending bytes is not cut off and can finish**; the next request is
  refused. The database keeps only the token's and the session's SHA-256, the build, the times and a download
  count (no addresses).
- Installer: `node scripts/update-packages.mjs installer --build <N|none>` chooses what new links serve. It can be
  the verified bridge build (stage it with its manifest; it is never published) or a published build. Withdrawing
  or rolling back that build clears the choice and closes its links. `status` shows it as `install links`.
- API: `POST`/`DELETE /api/admin/applications/:id/install-link`, with the same admin checks as the inbox API.
  `POST` answers 409 `UPDATES_NOT_APPROVED` or `NO_INSTALLER` when no link can be issued.
- Code: `src/lib/update-packages/install-{contracts,handlers,links}.ts`, `src/app/install`,
  `src/components/install/InstallLinkPage.tsx`, `src/components/admin/InstallLinkPanel.tsx`, migrations 0007, 0008
  and 0009. `install-links.integration.test.ts` runs on Postgres with `APPLICATIONS_TEST_DATABASE_URL`. It covers
  issuing, downloads over local HTTP, the button (a page from before and `HEAD` use nothing), sending once (whole
  for a range, two downloads at once, a link revoked, its approval or package withdrawn, or expired while the
  transfer waits, the database failing, a client gone before the transfer), links sent once out of reach of
  earlier versions,
  replacement, revocation (including a download already under way, and approval mails not yet sent), expiry,
  approval and package withdrawal, opening once (many presses at once, a revocation, expiry or approval withdrawal
  while an opening waits, a failed opening retried, a lost first answer with and without its cookie), links issued
  before 0008 and 0009 (two links open in one browser, resumes until expiry), and checks that no request line
  carried a secret.
- Before release, check on an isolated Preview with a synthetic link: open and reload it (nothing used), press the
  button (the download starts; a second download and a resume are refused, 410 `USED`), press it in another
  browser (`이미 사용되었습니다`), and confirm that neither the Runtime Logs nor an active Log Drain contain the
  token or the session secret. The `functions` pattern must be accepted by the Preview build and shown for the
  download function; the whole download must still arrive (cancellation ends a function only when its client goes
  away). The window it guards (between the first chunk and the transfer) is too short to hit reliably from outside,
  so a request cancelled in it keeping the transfer is checked by the tests (`install-links.integration.test.ts`,
  a local server that aborts `request.signal` as the client closes), not on Vercel.

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
