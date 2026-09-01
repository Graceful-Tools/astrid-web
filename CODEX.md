# OpenAI Codex Agent Context

*Configuration for the OpenAI-powered cloud coding agent (`openai@astrid.cc`).*

**Service:** OpenAI API. For the current default model, see [ASTRID.md](./ASTRID.md) →
"AI Agent System" and `lib/ai/agent-config.ts` (do not hard-code a model version here —
it drifts).
**Capabilities:** Code generation, code review, planning, GitHub operations.

> **Note:** This is the *cloud* OpenAI agent. The *local* Codex CLI reads
> [AGENTS.md](./AGENTS.md) instead and uses the distinct
> `codex@<BRAND.agentEmailDomain>` assignment identity.

---

## Agent Identity

This file provides OpenAI Codex-specific instructions for the AI coding agent. For comprehensive project context, patterns, and conventions, see **[ASTRID.md](./ASTRID.md)**.

---

## Primary Context

**Always read [ASTRID.md](./ASTRID.md)** for:
- Project architecture (web application)
- Code patterns and conventions
- Testing requirements
- Development workflow
- Quality standards

> **Note:** iOS app is in separate repository (https://github.com/Graceful-Tools/astrid-ios)

---

## Codex-Specific Instructions

### Workflow Expectations

1. **Understand the task** - Review task details, ASTRID.md, and existing implementations
2. **Plan first** - Create implementation plan before coding
3. **Implement deliberately** - Follow repository conventions (TypeScript, Tailwind, React)
4. **Validate** - Run quality checks before completing
5. **Document progress** - Post updates to task comments

### Response Format

- Use plain-text responses with markdown formatting
- Reference files with paths and line numbers (`components/foo.tsx:42`)
- Lead with outcome/findings, then supporting details
- Offer testing steps when verification is needed

### Code Generation

- Follow patterns in ASTRID.md
- Use TypeScript for web code
- Make incremental, logically grouped changes
- Add comments sparingly (only for non-obvious logic)

---

## Quality Checklist

Before completing tasks:
- [ ] TypeScript compiles (`npm run predeploy:quick`)
- [ ] Linting passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] Changes work as expected
- [ ] Document limitations or follow-up work

---

## Communication

- Post implementation plans as task comments before coding
- Post progress updates during implementation
- Post completion summary with commit details
- Wait for user approval before marking tasks complete

---

## Tool Usage

When using MCP tools:
- `get_repository_file` - Read files from repository
- `list_repository_files` - List directory contents
- `add_task_comment` - Post updates to tasks

---

## Documentation Rules

Root directory markdown files:
- `CLAUDE.md` - Claude Code CLI context
- `ASTRID.md` - Project context for all agents
- `CODEX.md` - OpenAI agent context (this file)
- `GEMINI.md` - Gemini agent context
- `README.md` - Project overview

All other docs go in `/docs/` subdirectories.

---

## See Also

- **[ASTRID.md](./ASTRID.md)** - Project context (REQUIRED reading)
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - System architecture
- **[docs/ai-agents/README.md](./docs/ai-agents/README.md)** - AI agent documentation
- **[docs/API_CONTRACT.md](./docs/API_CONTRACT.md)** - Stable external/mobile API contract

---

*This file is for the OpenAI Codex agent. For project context, see ASTRID.md.*
