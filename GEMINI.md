# Gemini AI Agent Context

*Configuration for the Google Gemini-powered cloud coding agent (`gemini@astrid.cc`).*

**Service:** Google Gemini API. For the current default model, see [ASTRID.md](./ASTRID.md) →
"AI Agent System" and `lib/ai/agent-config.ts` (do not hard-code a model version here —
it drifts).
**Capabilities:** Code generation, code review, planning, GitHub operations.

---

## Agent Identity

This file provides Gemini-specific instructions for the AI coding agent. For comprehensive project context, patterns, and conventions, see **[ASTRID.md](./ASTRID.md)**.

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

## Gemini-Specific Instructions

### Response Format

- Provide clear, structured responses
- Use markdown formatting for code blocks
- Include file paths with line numbers when referencing code
- Break complex tasks into steps

### Code Generation

- Follow patterns in ASTRID.md
- Use TypeScript for web code
- Include proper error handling
- Add comments for complex logic only

### Communication

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

## Quality Requirements

Before completing tasks:
- Ensure TypeScript compiles without errors
- Ensure ESLint passes
- Create appropriate tests
- Verify changes work as expected

---

## See Also

- **[ASTRID.md](./ASTRID.md)** - Project context (REQUIRED reading)
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - System architecture
- **[docs/FIXALL_WORKFLOW.md](./docs/FIXALL_WORKFLOW.md)** - the agent queue workflow

---

*This file is for the Gemini AI agent. For project context, see ASTRID.md.*
