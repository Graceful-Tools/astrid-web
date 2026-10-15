# Playwright Authentication

How signed-in Playwright tests get a session.

## There is no password sign-in to drive

The app signs in with Google, Apple and passkeys only. A test cannot type its
way in. Earlier versions of this guide (and `e2e/auth.setup.ts`, now deleted)
described a "Legacy email/password" form with `PLAYWRIGHT_TEST_EMAIL` /
`PLAYWRIGHT_TEST_PASSWORD`. That form is gone, and no credentials can make it
work (AWTD-1039).

## The session is minted

The web session is a NextAuth **JWT** (`session.strategy: "jwt"` in
`lib/auth-config.ts`). A token signed with `NEXTAUTH_SECRET` for a real user
row is a session. The server can't tell it apart from one issued by a real
sign-in.

- `e2e/utils/minted-session.ts` has the helpers: `mintSessionToken`,
  `sessionCookieName` and `sessionStorageState`.
- `scripts/create-e2e-auth-state.ts` (`npm run playwright:setup:ci-auth`)
  upserts two users in a **local test database**. It writes `.auth/user.json`
  (owner) and `.auth/outsider.json` (a user with no access) as Playwright
  storage states.

It used to write database `Session` rows instead. API routes accept those,
because they fall back to a DB lookup for mobile. The web UI reads only the
JWT, though, so a browser carrying a Session-row cookie was signed out. Keep it
a JWT.

## Running it locally

```bash
# Point at a local database whose name contains "test" (the script refuses anything else),
# migrated to the current schema. The dev server must use the same database and secret.
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/astrid_test
export NEXTAUTH_SECRET=<the same secret the dev server uses>

npm run playwright:setup:ci-auth
PLAYWRIGHT_AUTHENTICATED=1 npm run test:e2e:authenticated-critical
```

`PLAYWRIGHT_AUTHENTICATED=1` enables the `authenticated-critical` project in
`playwright.config.ts`, which loads `.auth/user.json`. CI does exactly this in
`.github/workflows/e2e-tests.yml`. `.auth/` is gitignored because it holds live
session tokens.

## Writing a signed-in test

Use the regular `test` import. Specs matched by a project with
`storageState: '.auth/user.json'` start signed in. For a second identity, open
a context from the other file:

```ts
const outsider = await browser.newContext({ storageState: path.resolve('.auth/outsider.json') })
```

Tokens last 30 days, matching `session.maxAge`. Re-run the provisioner rather
than committing or pasting one.
