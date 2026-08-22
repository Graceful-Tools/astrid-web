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

1. **Production deploys are MANUAL — pushing to `main` does NOT ship.** True by
   construction since #204 (2026-08-18): `production-deployment.yml` is
   `workflow_dispatch` only. Deploy from the Actions tab or with
   `./scripts/deploy-preview.sh --production`; migrations apply during that deploy,
   so verify their impact against production data first. Do not report work as
   shipped because you pushed.
   (docs/CLI_OPERATIONS.md §0 — this rule has been wrong four times, mostly by
   inferring the trigger from the Vercel deployment list, where Actions builds show
   as `source=cli`. Read the workflow file and `gh run list`.)
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
- Local Codex claims only tasks assigned to the distinct brand-derived
  `codex@<agent-domain>` polling identity. It is not the cloud OpenAI agent
  (`openai@<agent-domain>`) and must never claim that agent's assignments.
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
