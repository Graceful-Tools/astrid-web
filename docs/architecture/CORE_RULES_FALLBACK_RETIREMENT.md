# Retiring the TypeScript fallbacks behind astrid-core

*Plan and dated checklist, from AWTD-1591 (2026-11-11). Owner: whoever works the core-rules tasks.*

On the Node server, five rules are decided by astrid-core's WebAssembly build
(`packages/astrid-rules`, installed from `instrumentation.ts`). The TypeScript copy of each rule
is still there for two reasons:

1. **It is the browser's rule.** The browser can't load the wasm yet, so client components
   decide permissions, draw the board and parse search with the TypeScript.
2. **It is the server's fail-safe.** It answers whenever the core can't: the core didn't load,
   threw, or returned an error envelope or something that isn't an answer.

Until AWTD-1591 the server also ran the TypeScript on **every** decision, purely to compare it
with the core. That comparison is now **sampled**: in decide mode the core answers, and the
TypeScript runs on 1 decision in `ASTRID_CORE_RULES_SAMPLE` (default 20,
`lib/core-rules/sampling.ts`) and on every fallback. In shadow mode the core is asked on 1 in N.

**Since AWTD-1608 (2026-11-26)** step A is done for listAccess, searchParse, nextOccurrence and the
board's columns: the server no longer compares them at all. In decide mode the core answers and
the TypeScript runs only when the core cannot (`lib/core-rules/core-asker.ts`); in shadow mode
the core is not asked. Board drops and the Waiting lane are still sampled as above.

## Reading the evidence

`GET /api/health` returns `coreRules` (permissions), `coreRulesSearch`, `coreRulesRepeating` and
`coreRulesBoard`. Each has the following fields:

| Field | Meaning |
|---|---|
| `mode` | `decide` (the core answers), `shadow` (the TypeScript answers, the core is compared) or `off` |
| `compare` | `retired` for a rule past step A (`coreRules`, `coreRulesSearch`, `coreRulesRepeating`); `coreRulesBoard` shows `{ columns: 'retired', drops: 'sampled' }`. A retired rule's `stats` are `{ answered, skipped, failed }` only: there is no comparison to count. `coreRulesBoard.stats` is split into `columns` and `drops`. |
| `loaded` | Whether the wasm loaded. `decide` with `loaded: false` means the TypeScript is deciding everything. |
| `sampleEvery` | N: one decision in this many is compared |
| `stats.agreed` / `stats.disagreed` | Comparisons that matched or differed. Their sum is the number of comparisons, so the disagreement rate is `disagreed / (agreed + disagreed)` whatever N is. |
| `stats.unsampled` | Decisions the core answered without a comparison (decide), or did not ask the core about (shadow) |
| `stats.failed` | The core couldn't answer, so the TypeScript answered |
| `stats.skipped` | Not put to the core (outside its domain, such as a signed-out permission check) |

The totals are **per process** and reset on every deploy and cold start. The logs are
deduplicated per process: a disagreement is logged once per distinct shape, and a failure once.
So neither source shows 30 days on its own. A warm process can keep disagreeing after its one
log line has aged out, and a health check reads whichever instance answered it. The evidence is
both of these together:

- **No disagreement and no failure line in 30 days.** These are the `core-rules` logger's lines:
  "*astrid-core and the TypeScript disagree*", "*parse differently*" or "*roll over
  differently*" at `warn`, and "*could not answer*" at `error`. This only counts on serverless
  hosting, where an instance lives hours rather than weeks, so a repeated problem is logged
  again by each new instance.
- **Counter snapshots.** `/api/health` snapshots taken at least daily over the window, each
  showing `loaded: true`, `failed: 0`, `disagreed: 0` and a growing `agreed`. On a long-lived
  host (a self-hosted container), the snapshots are the evidence that counts. If they weren't
  collected, the window hasn't started.

If either is missing, postpone the retirement. Don't infer agreement from silence.

## The rule for retiring a fallback

A server fallback is retired when **all** of these hold:

1. **30 consecutive days with zero disagreements in production** for that rule, read from the
   logs as above, with `agreed > 0` in that window. Silence must be agreement, not a rule nobody
   called.
2. **Zero failures** in the same window, or every failure explained and fixed in the core.
3. **The browser runs the core for that rule** (AWTD-1586, "Run core rules in the browser"),
   which waits on AWTD2-162 (a smaller wasm). Until then the TypeScript is still the browser's
   rule and **cannot be deleted**. Only its use as a server comparison can stop.
4. **astrid-core `docs/CONTRACTS.md` names the core as canonical for the rule.** Then a
   behaviour change starts in the core, with web's TypeScript following, not the other way
   round.

So there are two steps per rule, and they are dated separately:

- **Step A: stop comparing on the server.** Gated on 1 and 2. Remove the comparison from that
  rule's own `lib/core-rules/*-core.ts` (or give it a per-rule switch). **Don't** raise
  `ASTRID_CORE_RULES_SAMPLE` for this: it sets N for every rule, so it would thin the evidence
  for rules that aren't ready. Even a very large N still compares each process's first decision.
  The TypeScript stays as the fail-safe.
- **Step B: delete the TypeScript rule.** Gated on 1–4. The browser and the server both call the
  core. The fail-safe becomes "refuse": a permission check that can't be answered is a deny, and
  a search that can't be parsed is a 503, never a guess.

## Checklist

The 30-day clock starts when the sampled build (AWTD-1591) is serving production and
`/api/health` shows `loaded: true` for the rule. If that deploy is later than 2026-11-14, move
every date below by the same amount.

| Rule | Core rule | TypeScript (server and browser) | Since | Step A, earliest | Step B, also needs | Done |
|---|---|---|---|---|---|---|
| List permissions | `listAccess` | `lib/list-permissions.ts` (~760 LOC) | AWTD-1061 | **2026-12-14** (taken early, see below) | AWTD-1586 | ☑ A (2026-11-26) ☐ B |
| Search query parse | `searchParse` | `lib/search-query-parser.ts` (~300) | AWTD-1062 | **2026-12-14** (taken early) | AWTD-1586 (search box) | ☑ A (2026-11-26) ☐ B |
| Repeating rollover | `nextOccurrence` | `types/repeating.ts` (~610) | AWTD-1063 | **2026-12-14** (taken early) | none for Step B on the server. The browser shows the next date but completes through the server. Check the client callers first. | ☑ A (2026-11-26) ☑ B (ADEV-306, 2026-11-26: the browser has no rollover caller, so the door stays without `nextOccurrence` and its zone table. The server refuses instead of guessing. The whole-rule `calculateTaskNextOccurrence` is deleted and the fixture's `completions` come from the core. `calculateNextOccurrence` and its siblings remain only for the fixture's `simple`/`custom` sections.) |
| Board columns | `board` | `getProjectBoardColumns`, `boardColumnsFor` | AWTD-1585 | **2026-12-14**, from AWTD-1585's deploy (taken early) | AWTD-1586 (the board and the menus are client code) | ☑ A (2026-11-26) ☐ B |
| Board drops | `boardMove` | `resolveProjectColumnMove`, `resolveColumnMove` | AWTD-1585 | **Blocked.** No server path asks for a drop yet. Drops now have their own counters (`coreRulesBoard.stats.drops`, AWTD-1608). The clock starts once a server caller exists. | AWTD-1586 | ☐ A ☐ B |
| Decision cards, trade-off grids | `decision`, `tradeoffGrid`, `ratingKey`; a grid is also a `tradeoffGrid` block from `renderMarkdown` | `lib/comment-formats.ts` (~230), browser only | AWTD-1626 (held to the core by `tests/lib/core-rules-decisions-parity.test.ts`) | n/a: no server caller, so there is nothing to sample | AWTD-1586 (every caller is client code). `RATING_STYLE`'s `className` values stay on web | ☐ B |
| List filters, sort, My Tasks, manual order, snooze | none on the stateless door yet (AWTD2-161) | `lib/date-filter-utils.ts`, `lib/task-sort.ts`, `lib/my-tasks-scope.ts`, `lib/recently-completed-window.ts`, `lib/reminder-snooze.ts` | AWTD-1583 adopted the core's answers in TypeScript | n/a: nothing to compare until the core exposes these rules | AWTD2-161, then AWTD-1586 | ☐ |

**Board columns, step B in progress (ADEV-307, 2026-11-26).** The browser door now installs the
board hook (`lib/core-rules/browser-board.ts`, inside the lazy load), so with
`NEXT_PUBLIC_ASTRID_CORE_RULES_BROWSER=on` the columns come from the core once it has loaded. Until
then, and when the core cannot answer, the TypeScript answers. A component that rendered before the
door loaded keeps its TypeScript columns until its next render (the two are held equal by the
fixture parity tests). Still to do before ticking B: re-render on load or accept it once the flag
is on in production, mark `board` canonical in astrid-core CONTRACTS.md and generate the fixture
from the core, then delete the TypeScript behind `getProjectBoardColumns` / `boardColumnsFor`.

**Step A evidence (AWTD-1608, 2026-11-26).** Production Vercel logs keep about 15 days, so the
read covered 2026-11-11 to 2026-11-26, about 14 days of the sampled build (in production since
2026-11-12). Across that window: no "disagree", "parse differently", "roll over differently",
"could not answer", "could not parse", "did not load" or "install failed" line for any rule.
`/api/health` showed every `coreRules*` block in `decide`, `loaded: true`, `failed: 0`,
`disagreed: 0`. Each rule was in use: listAccess on every request, 178 `/api/v1/search`
requests, about 14 repeating rollovers, and 50+ project-route requests a day for the board. No
daily snapshots were collected. Jon chose to take step A on this ~14-day read rather than wait
for 30 days (option 1 on AWTD-1608). The TypeScript stays as the server's fail-safe and the
browser's rule; the fixture parity tests still hold it to the core. Step B for each rule is its
own "[core-rules] Step B: …" task.

**On 2026-12-14** (the follow-up task "Retire the core-rules TypeScript fallbacks", due that
day): read 30 days of `core-rules` logs and the daily `/api/health` snapshots. For each rule that meets 1
and 2, do Step A and tick it here. For each that doesn't, write down what disagreed, fix it in
the core or in the TypeScript (the fixture first), and move its date out 30 days from the fix.

## What is canonical, meanwhile

astrid-core's `docs/CONTRACTS.md` used to say the web's TypeScript is the source of truth for
every shared rule ("change web first"). The fixtures are still generated from web, so for a
rule's **fixture** that stays true. For **behaviour**, the rules above are already decided by the
core on the server. CONTRACTS.md now says so (astrid-core PR from AWTD-1591): a change to one of
those rules is made in the core and in web's TypeScript in the same pair of PRs, with the fixture
regenerated from web. When a rule reaches Step B, its fixture moves to being generated from the
core.
