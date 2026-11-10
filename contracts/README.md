# Cross-platform contract fixtures

The JSON in `fixtures/` is **generated** from this repo's canonical sources by
`scripts/export-contract-fixtures.ts`. Never hand-edit it — a rule that is retyped is a rule that
drifts, which is the failure this whole mechanism exists to prevent.

```bash
npm run export:contract-fixtures   # regenerate
npm run check:contract-fixtures    # fail if stale (predeploy runs this)
```

[astrid-core](https://github.com/Graceful-Tools/astrid-core)'s Rust tests compile these files in,
so a stale fixture fails that suite rather than going unnoticed at runtime. The exporter lived in
astrid-core as `contracts/export-from-web.mjs` until AWTD-1031 moved it here, so the canonical
repo owns the export and every client consumes the same artifacts. The output did not change in
the move, apart from the `$comment` line naming the script.

## What is covered

| Fixture | Canonical source | Consumed by |
|---|---|---|
| `shortcuts.json` | `hooks/useKeyboardShortcuts.ts` — the `KEYBOARD_SHORTCUTS` table plus the `if (selectedTask)` guard read from the dispatch switch | `astrid_core::keyboard` |
| `repeating.json` | `types/repeating.ts` — **executed**, not parsed: every case is run through the calculator and the results recorded | `astrid_core::repeating` |
| `permissions.json` | `lib/list-permissions.ts` — **executed**: a case matrix recording all eight predicates per case | `astrid_core::permissions` |
| `board.json` | `lib/project-status.ts` — **executed**: which column each card is in, what every move writes, and what a new card carries | `astrid_core::board` |
| `statuses.json` | `lib/project-custom-states.ts` — **executed**: add, rename, reorder and remove, recording the role each add mints, every refusal and the array stored afterwards | `astrid_core::board` (the writers) |
| `editing.json` | `lib/editing-session.ts` — **executed**: scripted begin/end/cancel/commitAll sequences ([PRODUCT_CONTRACT.md](../docs/PRODUCT_CONTRACT.md) §6) | `astrid_core::editing` |
| `search.json` | `lib/search-query-parser.ts` — **executed**: every alias, the quoting rule, the identifier shape and the unknown-key fallback | `astrid_core::parse::search` |
| `smart.json` | `lib/task-manager-utils.ts` (`parseTaskInput`) and `lib/i18n/nlp-keywords.ts` — **executed** under a pinned clock across twelve languages, with the keyword tables alongside | `astrid_core::parse::smart` |
| `wire-shapes.json` | `/api/v1` itself — **executed**: fixed records read through each route's own Prisma select/include (`v1TaskListSelect`, `V1_TASK_READ_INCLUDE`, `V1_LIST_READ_INCLUDE`) and shaped by its own serializer, per surface: task list page (full and `?omit=`), task read, task event, list read, list event. Keys are exercised in all three states — value, null, absent | `model::Task` / `model::List` (decode → re-encode loses no key and invents none) |
| `decisions.json` | `lib/comment-formats.ts` — **executed**: the Decision and trade-off grid recognisers over the canonical example in [docs/DECISIONS.md](../docs/DECISIONS.md) and the edge cases (label forms including numbered options, code blocks, unrated and placeholder tables, replies by number or letter, row markers, column letters) | AstridCore `Decision.swift` (iOS/Mac) |
| `task-identifiers.json` | `tests/fixtures/task-identifiers.json` — **copied**: the server is the only minter, so there is only the case set every client must parse, autolink and show alike | `astrid_core::rows::identifier` |
| `agent-queue.json` | `app/api/v1/agent-queue/route.ts`, `lib/agent-queue.ts` — **executed**: response, queue, attention, empty/hint and scheduled/held summaries | AstridCore agent queue contract. AWTD-1550 adds the runnable-work verdict and event cursor additively in its own PR. |
| `agent-modes.json` | `app/api/v1/users/me/agent-modes/route.ts` — **executed**: GET rows and mode map, including the locked polling-only identity | AstridCore agent-modes contract. Any later fields are additive in their own PR. |
| `fixall-claim.json` | `app/api/v1/tasks/[id]/claim-fixall/route.ts` — **executed**: claimed, conflict, not-ready and forbidden response outcomes | AstridCore claim contract. AWTD-1550 adds general claim outcomes additively in its own PR. |
| `agent-registry.json` | `lib/brand/agent-emails.ts`, `lib/ai/harness-agents.ts` — **executed**: built-in mailboxes, polling-only harnesses and labels | AstridCore agent registry. Any later fields are additive in their own PR. |

## How the executed ones run

Each driver in `scripts/contract-fixtures/drivers/` runs in its own `node` process and imports the
TypeScript directly (Node's type stripping — **Node ≥ 22.18**). `alias-loader.mjs` maps `@/…` onto
the checkout and stubs three modules: the logger (pino), prisma (throws on any access, so a driver
that reached the database fails loudly), and `virtual-list-utils` (imports types as values). Drivers
run with `TZ=UTC`, because the custom repeat path uses local date methods and an unpinned fixture
would record whichever zone generated it.

The AWTD-1566 agent drivers run the current queue builder and API response handlers over fixed,
in-memory rows and auth context. Their test doubles fail on unexpected queries and do not connect
to a database or provider. The response JSON is generated from web code; fixtures are not
hand-authored examples.

## Changing a contract

A contract change is a cross-repo change, always in this order:

1. Change the canonical implementation here, with its tests.
2. `npm run export:contract-fixtures`, and commit the fixture in the same PR.
3. Update astrid-core until its tests pass again, then the clients that pin it.
4. Mirror it into astrid-ios (iOS and Mac share that code).

Deploy web first — the wire is the one thing every client shares.

AWTD-1550 consumes the agent fixtures as the baseline. Its runnable-work verdict, general claim
outcomes and event cursor are separate additive extensions; they belong in that task's own PR and
must not be backfilled into these characterization fixtures in advance.
