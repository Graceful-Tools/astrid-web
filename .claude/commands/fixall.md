Check the **Ready** list on the Astrid Web To-do and autonomously work every task on it to completion. Designed to be safe to re-run on a schedule.

**The procedure is harness-neutral and lives in two files. Read both before anything else:**

1. [docs/FIXALL_WORKFLOW.md](../../docs/FIXALL_WORKFLOW.md): the workflow shared with astrid-ios.
2. [docs/FIXALL_WEB.md](../../docs/FIXALL_WEB.md): what is different on the web board, covering
   the deploy rule, the definition of done, claiming, gates and environment gotchas.

Copilot and Codex read the same two files. This one holds only what is particular to
**Claude Code**:

- **Lock:** `npx tsx scripts/fixall-session.ts acquire --pid $PPID --harness claude-code`.
  Skip it when `ASTRID_FIXALL_LOCK_HELD=1` (the launchd runner holds it) or
  `ASTRID_FIXALL_EPHEMERAL=1` (an `agent-run.yml` runner). In the Bash tool, `$PPID` is the
  `claude` process. `$$` is a shell that exits at once, which records a dead pid.
- **Queue:** `get_agent_queue { agent: "claude", listId: "a623f322-4c3c-49b5-8a94-d2d9f00c82ba", includeUnassigned: true }`.
  Never poll as `copilot`.
- **Claim:** `npx tsx scripts/claim-fixall-task.ts <taskId> ready --agent claude`. Omitting
  `--agent` assigns the task to Copilot.
- **One task per scheduled run:** stop after `ASTRID_FIXALL_MAX_TASKS` tasks when it is set.
- **Scheduled `claude -p` limits:** `gh`, sibling-repo reads, `/tmp` writes and `npm install`
  are denied. Route scratch work through npm scripts and repo files.
