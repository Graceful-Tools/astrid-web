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

## Reading the evidence

`GET /api/health` returns `coreRules` (permissions), `coreRulesSearch`, `coreRulesRepeating` and
`coreRulesBoard`. Each has the following fields:

| Field | Meaning |
|---|---|
| `mode` | `decide` (the core answers), `shadow` (the TypeScript answers, the core is compared) or `off` |
| `loaded` | Whether the wasm loaded. `decide` with `loaded: false` means the TypeScript is deciding everything. |
| `sampleEvery` | N: one decision in this many is compared |
| `stats.agreed` / `stats.disagreed` | Comparisons that matched or differed. Their sum is the number of comparisons, so the disagreement rate is `disagreed / (agreed + disagreed)` whatever N is. |
| `stats.unsampled` | Decisions the core answered without a comparison (decide), or did not ask the core about (shadow) |
| `stats.failed` | The core couldn't answer, so the TypeScript answered |
| `stats.skipped` | Not put to the core (outside its domain, such as a signed-out permission check) |

The totals are **per process** and reset on every deploy and cold start. They can't show 30 days
on their own. The 30-day evidence is the log: every distinct disagreement is logged once per
process at `warn` by the `core-rules` logger, as "*astrid-core and the TypeScript disagree*",
"*parse differently*" or "*roll over differently*". Every failure is logged at `error`. A
30-day window with **no such line**, alongside health snapshots showing `loaded: true` and
`agreed > 0` for each rule, is the bar.

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

- **Step A: stop comparing on the server.** Gated on 1 and 2. Set `ASTRID_CORE_RULES_SAMPLE` to
  a very large N, or remove the comparison from the rule's `lib/core-rules/*-core.ts`. The
  TypeScript stays as the fail-safe.
- **Step B: delete the TypeScript rule.** Gated on 1–4. The browser and the server both call the
  core. The fail-safe becomes "refuse": a permission check that can't be answered is a deny, and
  a search that can't be parsed is a 503, never a guess.

## Checklist

The 30-day clock starts when the sampled build (AWTD-1591) is serving production and
`/api/health` shows `loaded: true` for the rule. If that deploy is later than 2026-11-14, move
every date below by the same amount.

| Rule | Core rule | TypeScript (server and browser) | Since | Step A, earliest | Step B, also needs | Done |
|---|---|---|---|---|---|---|
| List permissions | `listAccess` | `lib/list-permissions.ts` (~760 LOC) | AWTD-1061 | **2026-12-14** | AWTD-1586 | ☐ A ☐ B |
| Search query parse | `searchParse` | `lib/search-query-parser.ts` (~300) | AWTD-1062 | **2026-12-14** | AWTD-1586 (search box) | ☐ A ☐ B |
| Repeating rollover | `nextOccurrence` | `types/repeating.ts` (~610) | AWTD-1063 | **2026-12-14** | none for Step B on the server. The browser shows the next date but completes through the server. Check the client callers first. | ☐ A ☐ B |
| Board columns and drops | `board`, `boardMove` | `lib/project-status.ts`, `lib/task-status.ts` (board parts) | AWTD-1585 | **2026-12-14**, from AWTD-1585's deploy | AWTD-1586; the drag, the menus and the status row are client code | ☐ A ☐ B |
| List filters, sort, My Tasks, manual order, snooze | none on the stateless door yet (AWTD2-161) | `lib/date-filter-utils.ts`, `lib/task-sort.ts`, `lib/my-tasks-scope.ts`, `lib/recently-completed-window.ts`, `lib/reminder-snooze.ts` | AWTD-1583 adopted the core's answers in TypeScript | n/a: nothing to compare until the core exposes these rules | AWTD2-161, then AWTD-1586 | ☐ |

**On 2026-12-14** (the follow-up task "Retire the core-rules TypeScript fallbacks", due that
day): read 30 days of `core-rules` logs and today's `/api/health`. For each rule that meets 1
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
