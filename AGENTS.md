# Codex — Astrid Web Operational Adapter

*Local Codex CLI workflow for the Astrid web app.*

**Repository:** https://github.com/Graceful-Tools/astrid-web
**iOS app (separate repo):** https://github.com/Graceful-Tools/astrid-ios

This is a thin adapter. It holds only Codex-specific notes. Everything else lives in
exactly one place:

- **[ASTRID.md](./ASTRID.md)** — project architecture, code patterns, and the per-task
  coding workflow (read by ALL agents; **read it before writing code**).
- **[docs/CLI_OPERATIONS.md](./docs/CLI_OPERATIONS.md)** — deploy, "ship it", "let's fix
  stuff", quality gates, OAuth, pre-approved commands.

> **Do not duplicate architecture or ops into this file.** This file was previously a
> broken mechanical copy of CLAUDE.md (it invented a `.codex/` permission path and a
> `codex@astrid.cc` agent that don't exist). Keep it thin and point at the shared docs.

---

## Critical rules

1. **Vercel auto-deploy is OFF — pushing to `main` does NOT deploy.** Production deploy
   is a separate manual step (`./scripts/deploy-preview.sh --production`) that needs user
   approval. (docs/CLI_OPERATIONS.md §0)
2. **NEVER** run `vercel pull` / `vercel link` / `vercel env pull` — they overwrite
   `.env.local`. Only *push* deployments.
3. **Always ask "Ready to ship it?" before pushing, merging, or deploying.** Local commits
   are autonomous. (docs/CLI_OPERATIONS.md §1)
4. **Bug fixes are TDD:** RED regression test (name the task id) → green → `npm run predeploy`.
   Auth changes → run the full suite before committing. (ASTRID.md → Coding Workflow)
5. **Tasks use the `listIds` array field** (not `listId`); the API uses the `X-OAuth-Token`
   header (not `Authorization: Bearer`).
6. **Reuse before you write.** Never inline owner/admin checks or hardcode user-facing
   copy — use the `lib/list-permissions.ts` helpers and i18n keys. Run `npm run check:reuse`.
   Full rules: ASTRID.md → *Agent Working Agreements → Code Reuse & Consistency* and
   [docs/CODE_REUSE_AND_CONSISTENCY.md](./docs/CODE_REUSE_AND_CONSISTENCY.md).

---

## Codex-specific notes

- Codex reads this file (`AGENTS.md`) automatically; it does **not** use Claude Code's
  `.claude/` permission system. The `npm run validate:settings:fix` step in
  docs/CLI_OPERATIONS.md §3 is Claude-Code-only — skip it under Codex.
- There is no `codex@astrid.cc` cloud agent. Registered agents are `claude@astrid.cc`,
  `openai@astrid.cc`, `gemini@astrid.cc`, `openclaw@astrid.cc`. Codex here is a *local*
  CLI, not a registered task assignee.
- Response style: lead with the outcome, reference files as `path:line`, keep turns short.

---

## Quick reference

| Need | Go to |
|------|-------|
| Architecture, code patterns, coding workflow | [ASTRID.md](./ASTRID.md) |
| Deploy / ship it / fix stuff / quality gates / OAuth | [docs/CLI_OPERATIONS.md](./docs/CLI_OPERATIONS.md) |
| Full docs index | [docs/README.md](./docs/README.md) |

---

*This file is for Codex. Claude Code reads [CLAUDE.md](./CLAUDE.md); cloud agents read
[CODEX.md](./CODEX.md) / [GEMINI.md](./GEMINI.md). All share [ASTRID.md](./ASTRID.md).*
