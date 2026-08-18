# Weekly Hygiene Review

A scheduled Claude Code run that reviews the repo across five lenses — hygiene, code
duplication, security, performance, documentation — and files what it finds as tasks on the
**Astrid Web To-do**. Findings needing a Swift change go to the **Astrid iOS To-do** instead.

It runs **Fridays at 15:50 local** via launchd. It is read-only on code: it never commits,
pushes, or deploys. Its only side effect is filing tasks.

## Files

| File | Role |
|------|------|
| `scripts/weekly-hygiene-review.sh` | The runner — refreshes the worktree, then invokes Claude Code headless |
| `scripts/weekly-hygiene-review.prompt.md` | What the review actually does. **Edit this to change the review.** |
| `scripts/run-weekly-hygiene-review.mjs` | launchd shim (see *Why node* below) |
| `scripts/launchd/cc.astrid.weekly-hygiene-review.plist` | Schedule template |

## Install

The job runs from a **dedicated worktree** that nobody works in, so the schedule never
depends on which branch a shared checkout happens to be sitting on:

```bash
git worktree add ../astrid-web-hygiene main
cp scripts/launchd/cc.astrid.weekly-hygiene-review.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/cc.astrid.weekly-hygiene-review.plist
```

The plist sets `HYGIENE_SELF_UPDATE=1`, which hard-resets that worktree to `origin/main` at
the start of every run — so prompt and runner changes take effect the moment they land on
main, with no reinstall. **Only ever set it for a checkout nobody works in.** It refuses to
self-update if the worktree has local changes, and runs what is checked out instead, rather
than destroying someone's work.

Paths in the plist are absolute — launchd does not expand `~`. Edit them if your checkout
lives elsewhere.

```bash
npm run hygiene:review -- --setup-only   # verify the plumbing, file nothing
npm run hygiene:review                   # full run, files real tasks
launchctl kickstart -k gui/$(id -u)/cc.astrid.weekly-hygiene-review   # run as launchd would
```

Log: `~/Library/Logs/astrid-weekly-hygiene-review.log` (appends; no rotation).

## How it works

The review runs against a **throwaway detached worktree** at `../astrid-web-review`, re-pinned
to `origin/main` at the start of every run. Your working tree and current branch are never
touched, and the review always reads `main` rather than whatever you happen to have checked
out. `.env.local` is symlinked from the primary checkout — secrets are never copied.

`npm ci` runs only when `package-lock.json`'s hash changes.

## Why node, not zsh (do not "simplify" this)

launchd runs the job through `scripts/run-weekly-hygiene-review.mjs` rather than pointing
straight at the shell script. A `/bin/zsh` launched by launchd has **no TCC access to
`~/Documents`**, so the run dies at the first `git` call with:

```
fatal: Unable to read current working directory: Operation not permitted
```

`/opt/homebrew/bin/node` holds a Full Disk Access grant and children inherit it. Measured:

```
zsh direct read : DENIED
node fs.readdir : OK
node->zsh child : OK
```

This is the same reason `cc.astrid.user-feedback` works — it execs `npx tsx`, so node is the
responsible process. Pointing launchd at the shell script directly makes the job fail
silently every week: two lines in the log, no review, no tasks.

## Tuning the review

Everything the review does lives in `scripts/weekly-hygiene-review.prompt.md`. Notable
guardrails already encoded there:

- **Dedupe first.** It reads the open board before reviewing and will not restate an open
  task. Duplicate tasks are worse than missed ones.
- **Cap of 8 tasks**, ranked by impact × confidence. Filing zero is an accepted outcome.
- **Never runs `npm run predeploy`** — that files its own tasks and would pollute the board.
- **Never runs `npm run monitor:vercel*`.** Even `:no-fix` posts comments onto real Astrid
  tasks, and `vercel` is not a dependency of this repo, so it fails and then reports healthy.
  On 2026-08-18 it wrote three misleading "Deployment Issues Resolved" comments, one of them
  onto a task it matched only because the title contained the substring `build`. Production
  runtime logs are out of scope for this job until a genuinely read-only path exists.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_BIN` | `~/.local/bin/claude` | Path to the Claude Code binary |
| `HYGIENE_REVIEW_MODEL` | `opus` | Model used for the review |
| `HYGIENE_SELF_UPDATE` | `0` | `1` hard-resets the runner's own checkout to `origin/main` first. Dedicated worktrees only. |
