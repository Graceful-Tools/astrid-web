# Testing Strategy

How the web app is tested, which tier a test belongs in, and how the ratchets keep the
suite honest. This is the one strategy doc; [docs/testing/](../testing/) holds the
Playwright and MCP how-tos and links back here.

Exact dependency versions live in [the canonical stack reference](./stack.md) and are
verified against [`package.json`](../../package.json) by `npm run check:docs`.

## The tiers

| Tier | Config / command | Lives in | Belongs here |
|------|------------------|----------|--------------|
| Unit / jsdom | `npm run test:run` ([`vitest.config.ts`](../../vitest.config.ts)) | `tests/lib`, `tests/components`, `tests/hooks`, `tests/auth`, `tests/i18n`, … | Pure functions, hooks, React components with mocked context |
| Route | same config | `tests/api` | One route handler called directly, Prisma and auth mocked |
| Rules | same config | `tests/rules` | Repo-wide invariants over source, config and docs (ratchets, "never do X") |
| Scripts | same config | `tests/scripts` | The `scripts/*.ts` tooling the fleet runs |
| Risk | `npm run test:risk-coverage` ([`vitest.risk.config.ts`](../../vitest.risk.config.ts)) | an explicit include list | Auth, permissions and other high-risk code, held to its own coverage floor |
| Postgres | `npm run test:integration:postgres` ([`vitest.postgres.config.ts`](../../vitest.postgres.config.ts)) | files named by that config | Behaviour that only a real database proves (constraints, transactions, timestamps) |
| Live | `npm run test:live:github-projects` ([`vitest.live.config.ts`](../../vitest.live.config.ts)) | `tests/live` | Smoke tests against a real third party; never part of predeploy |
| Test-tree typecheck | `npm run typecheck:tests` ([`tsconfig.test-tree.json`](../../tsconfig.test-tree.json)) | all of `tests/` | Keeps the tests compiling; the error count is held at zero |
| End to end | Playwright ([`playwright.config.ts`](../../playwright.config.ts)) | `e2e/` | Whole-browser flows |

Other directories under `tests/` (`mcp`, `sdk`, `workflows`, `contracts`, `middleware`,
`integration`, …) are unit or route tests grouped by the code they cover; they run in the
main config.

### Playwright projects

Not every browser runs every spec. `chromium` runs the broad public specs. `firefox`,
`webkit` and `Mobile Safari` run only the auth and locale-navigation specs. The signed-in
projects (`authenticated-critical`, `authenticated-ui`) are Chromium only and need
`PLAYWRIGHT_AUTHENTICATED=1` (the npm scripts set it). The `computer-*` and `tablet-*`
projects pin a viewport each to catch layout regressions. A signed-in check on Firefox or
WebKit does not exist; do not assume one. See [E2E quickstart](../testing/E2E_QUICKSTART.md)
and [Playwright setup](../testing/PLAYWRIGHT_SETUP.md).

## Global setup

`tests/setup.ts` runs before every file in the main, risk and Postgres-adjacent configs. It
mocks Prisma (`mockPrisma`, exported), next-auth, Redis, `sse-manager`, i18n and OpenAI,
and stubs browser APIs. A test needing different behaviour overrides a method on
`mockPrisma` rather than re-mocking `@/lib/prisma`. The suite runs in UTC; a test about
time zones sets `process.env.TZ` itself.

## Route tests: use the harness

`tests/utils/route-harness.ts` builds the request, signs the caller in, seeds Prisma rows
and returns the parsed JSON. Write a route test with it instead of repeating
`vi.mock('@/lib/api-auth-middleware', …)` file by file. See the header of that file for the
API. Seed rows through [`tests/fixtures/prisma-rows.ts`](../../tests/fixtures/prisma-rows.ts)
and [`tests/fixtures/prisma.ts`](../../tests/fixtures/prisma.ts) (Postgres builders).

A route test covers the cases a route owes: unauthenticated (401), wrong scope or no access
(403 or 404), validation (400), the happy path, and each documented side effect.

## Which kind of test

- **Write a behavioural test by default**: call the code, assert on the result or the
  Prisma call it makes.
- **Write a rule** (`tests/rules`) when the property is about the codebase rather than one
  call: "no route imports X", "this list only shrinks", "this doc names a file that exists".
- **A source-string pin** (reading a file and matching text) is a last resort. Use it only
  when the behaviour cannot be run in a test, and say why in a comment.
- **Bug fixes are RED first**: a failing test that names the task id, then the fix
  ([ASTRID.md → Coding Workflow](../../ASTRID.md#coding-workflow-required-for-all-ai-agents)).

## Naming and where tests go

- **Put the task id in the `describe` or test name, not the filename.** One route has one
  file, named for the route (`tests/api/v1-task-comments.test.ts`), and a new behaviour or
  regression extends that file with a new `describe`. A file named for a task id scatters one
  route's behaviour across many small files.
- Before adding a test file, look for the route's or module's existing one.
- Test names say the behaviour: `returns 404 when the caller is not on the task`.

## Ratchets

A ratchet is a number that may only move one way. A change that makes it worse fails; a
change that makes it better lowers the budget in the same commit.

- **Coverage**: the thresholds in [`vitest.config.ts`](../../vitest.config.ts) are the
  current floor, set from a measurement. Raise them when coverage rises.
- **Risk surface**: [`vitest.risk.config.ts`](../../vitest.risk.config.ts) lists the risk
  files and their floor; `tests/rules/risk-config-paths-exist.test.ts` fails when a listed
  path stops matching a file.
- **Design metrics**: `npm run check:design` counts hand-written colours, sizes and copy
  ([design system](../specs/DESIGN_SYSTEM.md)).
- **Oversized files**: `tests/rules/oversized-files-ratchet.test.ts`.
- **Every route has a test**: `tests/rules/every-route-has-a-test.test.ts` holds a
  shrink-only allowlist of untested routes.
- **Reuse**: `npm run check:reuse`.
- Others sit in `tests/rules/` (Prisma in routes, raw fetch mutations, …). Read the
  failing test's header for how to lower its budget.

## Commands

```bash
npm run test:run                      # main suite, once
npm run test:run -- tests/api/<file>  # one file
npm run test:coverage                 # with the coverage gate
npm run typecheck:tests               # test-tree typecheck
npm run check:docs                    # doc links and script inventory
npm run predeploy                     # everything the deploy gate runs
```

[Predeploy testing and quality gates](../guides/PREDEPLOY_TESTING.md) says what
`predeploy` runs and how to read it.
