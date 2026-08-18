# Weekly hygiene review — Astrid Web

You are running **unattended**. Nobody will answer a question, so never stop to ask one:
make the call, state the assumption in your summary, and keep going.

Your working directory is a detached-HEAD git worktree pinned to `origin/main`. It is a
throwaway checkout — it is NOT Jon's working tree. Read `CLAUDE.md` and `ASTRID.md` first.

## Hard rules

- **Read-only on code.** Do not edit, commit, push, merge, or deploy anything. Do not run
  `npm run predeploy` (it files its own Astrid tasks and would pollute the board), any
  `deploy:*` script, or any `db:*` script that writes.
- **Never run `npm run monitor:vercel*`** — it writes comments to the Astrid board (see step 2).
- Your only writes are Astrid tasks (step 4) and the summary you print (step 5).

## Step 1 — Load the board first (dedupe)

```bash
npx tsx scripts/get-astrid-tasks.ts
```

Hold on to every open task title. **Nothing you file may restate an open task.** Duplicate
tasks are worse than missed ones — they make the board untrustworthy.

## Step 2 — Gather evidence

Run these (all read-only). If one fails, note it and continue; a broken check is itself a
finding worth reporting in the summary.

```bash
git log --oneline --since='8 days ago' origin/main
git diff --stat "@{8 days ago}"...origin/main
npm run check:reuse:warn
npm run lint 2>&1 | tail -60
npm run typecheck 2>&1 | tail -40
npm run check:model-sync
npm run check:api-breaking
npm audit --omit=dev 2>&1 | tail -40
curl -s -o /dev/null -w 'health %{http_code} %{time_total}s\n' https://astrid.cc/api/health
curl -s -o /dev/null -w 'home   %{http_code} %{time_total}s\n' https://astrid.cc/
```

**Do not run `npm run monitor:vercel*`.** Even the `:no-fix` variant posts "Deployment Issues
Resolved" comments onto real Astrid tasks, and `vercel` is not a dependency of this repo, so
in this worktree it fails and then reports healthy anyway. On 2026-08-18 it wrote two
misleading comments before it could be stopped. Production runtime logs are therefore out of
scope for this job until a genuinely read-only path exists — say so in your summary rather
than reaching for that script.

Weight the review toward **the week's diff** — that is where fresh regressions live — but do
not ignore standing problems the tools surface.

## Step 3 — Review across five lenses

Spend real effort here. Reprinting tool output is not a review; the value is in what a
careful reader notices that no linter flags.

1. **Hygiene** — dead code and unreferenced scripts, stale feature flags, TODO rot, files
   that outgrew their home, drift between `CLAUDE.md` / `AGENTS.md` / `ASTRID.md`.
2. **Code duplication** — the same logic in two or more places; owner/admin checks inlined
   instead of using `lib/list-permissions.ts`; user-facing copy hardcoded instead of i18n
   keys. See `docs/CODE_REUSE_AND_CONSISTENCY.md`.
3. **Security** — authorization gaps on API routes (especially routes added in this week's
   diff), missing OAuth scope checks, secrets committed to code, unvalidated input reaching
   Prisma, over-permissive CORS, vulnerable dependencies.
4. **Performance** — N+1 Prisma queries, missing indexes, unbounded `findMany`, cache
   misuse, oversized client bundles, and any slow or erroring production route surfaced by
   the Vercel log scan.
5. **Documentation** — docs that contradict the code, undocumented new env vars / scripts /
   API routes, stale runbooks. Treat this as load-bearing: the deploy section of these docs
   has now been confidently wrong in **both** directions, and an agent acted on each. Never
   restate deploy behaviour from memory or infer it from the shape of the deployment list —
   ask production what commit it is actually serving, and say what you verified rather than
   what a doc claims. If you file anything about deploy behaviour, the evidence must be a
   live check, not a quotation.

## Step 4 — File tasks

- **Cap: 8 tasks.** Rank by (real user or security impact × your confidence) and file only
  the top ones. **Filing zero tasks is a valid, respectable outcome** — say so plainly
  rather than padding the board.
- Every task must be independently actionable: the **title states the fix**, the description
  gives `file:line` evidence, why it matters, and the concrete change. No "audit X",
  "investigate Y", or "consider Z" tasks.
- Before filing, check that the thing is not a deliberate past decision. Examples on record:
  `lib/cache-manager.ts` is intentionally not split; `/api/v1/*` and `/api/*` are NOT
  duplicates — iOS uses both.
- Prefix every title with `[hygiene]` so the weekly batch is filterable.

Web / server findings:

```bash
npx tsx scripts/create-task.ts "[hygiene] <title>" "<description>" -p <1|2|3>
```

Priority scale is `0=none, 1=low, 2=medium, 3=high`. Use `3` only for a security hole or
active production breakage, `2` for a real defect worth scheduling, `1` for nice-to-have.

Findings that require a Swift change go to the iOS board instead — never commit to
`astrid-ios`:

```bash
npx tsx scripts/file-ios-task.ts "[ios] <what iOS must do>" "<contract to match>" -p 2
```

## Step 5 — Summary

Print, in this order: what you checked (and anything that failed to run), what you filed by
**title** (Jon does not read task ids), and what you found but deliberately did not file,
with the reason. Be honest about coverage you skipped.
