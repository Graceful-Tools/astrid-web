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
| `task-identifiers.json` | `tests/fixtures/task-identifiers.json` — **copied**: the server is the only minter, so there is only the case set every client must parse, autolink and show alike | `astrid_core::rows::identifier` |

## How the executed ones run

Each driver in `scripts/contract-fixtures/drivers/` runs in its own `node` process and imports the
TypeScript directly (Node's type stripping — **Node ≥ 22.18**). `alias-loader.mjs` maps `@/…` onto
the checkout and stubs three modules: the logger (pino), prisma (throws on any access, so a driver
that reached the database fails loudly), and `virtual-list-utils` (imports types as values). Drivers
run with `TZ=UTC`, because the custom repeat path uses local date methods and an unpinned fixture
would record whichever zone generated it.

## Changing a contract

A contract change is a cross-repo change, always in this order:

1. Change the canonical implementation here, with its tests.
2. `npm run export:contract-fixtures`, and commit the fixture in the same PR.
3. Update astrid-core until its tests pass again, then the clients that pin it.
4. Mirror it into astrid-ios (iOS and Mac share that code).

Deploy web first — the wire is the one thing every client shares.
