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

Run migrations and the server with the same owning role. Row level security is on with no policies, so hosted
data APIs (for example Supabase's `anon` key) cannot read the list. View the list with the database
provider's own console. The site has no endpoint that lists requests. Never log or screenshot real entries.

Integration tests need a disposable Postgres database. They create and drop their own schema and use
synthetic data only:

```bash
APPLICATIONS_TEST_DATABASE_URL=postgres://... npm run test:run
```

## Download link

The site has no download button or link to GitHub Releases for now. Releases themselves are unchanged; the app's
update check still reads them. Build numbers and SHA-256 checksums belong in the release notes, not on the site.
