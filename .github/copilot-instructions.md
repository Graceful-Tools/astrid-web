# GitHub Copilot instructions

Before changing code, read [ASTRID.md](../ASTRID.md).

- For local CLI, deployment, quality-gate, and OAuth operations, read
  [docs/CLI_OPERATIONS.md](../docs/CLI_OPERATIONS.md).
- For `/fixall`, queue, or Astrid task automation, read
  [docs/FIXALL_WORKFLOW.md](../docs/FIXALL_WORKFLOW.md).

These files are canonical. Do not copy their contents into this file or an
agent-specific adapter. Verify executable behavior against `package.json`
scripts and `.github/workflows/`. If guidance conflicts with behavior or other
canonical guidance, stop and reconcile it instead of selecting stale prose.

When editing `fixall.yml`, `fixstuff.yml`, or `predeploy.yml`, validate the
entire execution path: dedicated runner labels; the exact secrets and
environment variables consumed; versioned machine-readable queue JSON; a
dry-run that neither claims nor triggers; atomic eligibility and assignment
revalidation; an authenticated trigger; and persisted job outputs. Never parse
human-oriented task output or treat summaries as execution.

Use the smallest targeted tests while iterating. The final gate is
`npm run predeploy`; use `npm run predeploy:full` when Playwright/E2E behavior
or a workflow explicitly requires it. Do not present targeted checks as the
final gate.

For an existing PR, commit and push, then verify
`gh pr view <number> --json headRefOid` matches the intended commit before
reporting completion. If it does not, report the exact running or failing
command rather than claiming local-only work is done.

Follow the canonical documents for architecture, TDD, task operations,
releases, i18n, permissions, and deployment; link to them rather than
duplicating their rules here.
