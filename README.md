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

## Download link

The download buttons point at `https://github.com/yusagil/nokka-web/releases/latest/download/Nokka.dmg`
(`src/lib/links.ts`), so publishing a new GitHub Release with an asset named exactly `Nokka.dmg`, marked latest
(not draft or prerelease), updates the site without a code change. Build numbers and SHA-256 checksums belong in
the release notes, not on the site.
