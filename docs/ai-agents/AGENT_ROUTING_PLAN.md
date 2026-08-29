# AI Agent Routing & Documentation Restructure Plan

*Comprehensive plan for improving AI agent routing and documentation organization*

**Created:** 2024-11-27
**Status:** COMPLETED (2024-11-27)

---

## Executive Summary

This plan addresses two interconnected improvements:

1. **AI Agent Routing** - Centralize and extend agent email routing to support Claude, OpenAI, and Gemini
2. **Documentation Restructure** - Clarify the purpose of root-level markdown files and align with unified monorepo (web + iOS)

---

## Part 1: AI Agent Routing Improvements

### Current State

**Location:** `services/implementations/ai-orchestration.service.ts` (lines 119-128)

```typescript
// CURRENT: Hardcoded routing
let aiService: 'claude' | 'openai' = 'claude' // default

if (task.assignee?.email === 'claude@astrid.cc') {
  aiService = 'claude'
} else if (task.assignee?.email === 'openai-codex@astrid.cc') {
  aiService = 'openai'
}
```

**Problems:**
- Only 2 agents supported (hardcoded)
- No Gemini support
- No context file routing
- AIOrchestrator type only allows `'claude' | 'openai'`

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TASK ASSIGNMENT                          │
│   User assigns task to: claude@astrid.cc                   │
│                        codex@astrid.cc                     │
│                        gemini@astrid.cc                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              AI_AGENT_CONFIG (centralized)                  │
│                                                             │
│   claude@astrid.cc  → { service: 'claude', model: '...' }  │
│   codex@astrid.cc   → { service: 'openai', model: '...' }  │
│   gemini@astrid.cc  → { service: 'gemini', model: '...' }  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   AIOrchestrator                            │
│   - Loads agent config by email                            │
│   - Loads context files (ASTRID.md + agent-specific)       │
│   - Routes to appropriate API (Claude/OpenAI/Gemini)       │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Steps

#### Step 1.1: Create Centralized Agent Config

**File:** `lib/ai-agent-config.ts`

```typescript
/**
 * Centralized AI Agent Configuration
 * Single source of truth for all AI agent routing
 */

export type AIService = 'claude' | 'openai' | 'gemini'

export interface AIAgentConfig {
  service: AIService
  model: string
  contextFile: string        // Agent-specific context (CLAUDE.md, CODEX.md, GEMINI.md)
  fallbackContextFile: string // Project context all agents read (ASTRID.md)
  displayName: string
  capabilities: string[]
}

export const AI_AGENT_CONFIG: Record<string, AIAgentConfig> = {
  'claude@astrid.cc': {
    service: 'claude',
    model: 'claude-sonnet-4-20250514',
    contextFile: 'CLAUDE.md',
    fallbackContextFile: 'ASTRID.md',
    displayName: 'Claude AI Agent',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  'codex@astrid.cc': {
    service: 'openai',
    model: 'gpt-4o',
    contextFile: 'CODEX.md',
    fallbackContextFile: 'ASTRID.md',
    displayName: 'OpenAI Codex Agent',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  'gemini@astrid.cc': {
    service: 'gemini',
    model: 'gemini-2.0-flash',
    contextFile: 'GEMINI.md',
    fallbackContextFile: 'ASTRID.md',
    displayName: 'Gemini AI Agent',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
} as const

// Helper functions
export function getAgentConfig(email: string): AIAgentConfig | null {
  return AI_AGENT_CONFIG[email] || null
}

export function getAgentService(email: string): AIService {
  return AI_AGENT_CONFIG[email]?.service || 'claude'
}

export function isRegisteredAgent(email: string): boolean {
  return email in AI_AGENT_CONFIG
}

export function getRegisteredAgentEmails(): string[] {
  return Object.keys(AI_AGENT_CONFIG)
}
```

#### Step 1.2: Update AIOrchestrator Type

**File:** `lib/ai-orchestrator.ts`

```typescript
// BEFORE (line 63)
private aiService: 'claude' | 'openai'

// AFTER
private aiService: AIService  // 'claude' | 'openai' | 'gemini'
```

#### Step 1.3: Add Gemini API Support

**File:** `lib/ai-orchestrator.ts` - Add new method:

```typescript
private async callGemini(prompt: string, apiKey: string, jsonOnly: boolean = false): Promise<string> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`)
  }

  const data = await response.json()
  return data.candidates[0].content.parts[0].text
}
```

#### Step 1.4: Update Routing in AIOrchestrationService

**File:** `services/implementations/ai-orchestration.service.ts`

```typescript
// BEFORE (lines 119-128)
let aiService: 'claude' | 'openai' = 'claude'
if (task.assignee?.email === 'claude@astrid.cc') {
  aiService = 'claude'
} else if (task.assignee?.email === 'openai-codex@astrid.cc') {
  aiService = 'openai'
}

// AFTER
import { getAgentService, AIService } from '@/lib/ai-agent-config'

const aiService: AIService = task.assignee?.email
  ? getAgentService(task.assignee.email)
  : 'claude'

console.log(`🤖 [AIOrchestrationService] Routed to ${aiService} for agent: ${task.assignee?.email}`)
```

#### Step 1.5: Update Agent Setup Script

**File:** `scripts/create-specific-ai-agents.ts`

Add Gemini agent and rename OpenAI agent email:

```typescript
const agents = [
  { email: 'claude@astrid.cc', name: 'Claude AI Agent', type: 'claude_agent' },
  { email: 'codex@astrid.cc', name: 'OpenAI Codex Agent', type: 'openai_agent' },
  { email: 'gemini@astrid.cc', name: 'Gemini AI Agent', type: 'gemini_agent' },
]
```

#### Step 1.6: Database Migration (if needed)

Rename existing agent email in production:
```sql
UPDATE "User"
SET email = 'codex@astrid.cc'
WHERE email = 'openai-codex@astrid.cc';
```

---

## Part 2: Documentation Restructure

### Current State

**Root directory files:**
| File | Lines | Purpose (Current) |
|------|-------|-------------------|
| `CLAUDE.md` | 740+ | Mixed: Claude Code CLI + workflow + project context |
| `ASTRID.md` | 740+ | AI agent setup guide + project patterns |
| `GPT-5-CODEX.md` | ? | OpenAI agent context |
| `README.md` | 390 | Project overview |

**Problems:**
- CLAUDE.md is overloaded (serves CLI AND cloud agents)
- No clear separation between CLI instructions and project context
- No Gemini context file
- iOS documentation scattered

### Proposed Structure

```
Root Directory (AI Agent Context Files):
├── CLAUDE.md      → Claude Code CLI operations (SLIMMED DOWN)
├── CODEX.md       → OpenAI cloud agent context (RENAMED from GPT-5-CODEX.md)
├── GEMINI.md      → Gemini cloud agent context (NEW)
├── ASTRID.md      → Project architecture & conventions (ALL agents read)
└── README.md      → Project overview (for humans)

docs/
├── README.md               → Documentation index
├── ARCHITECTURE.md         → System architecture (web + iOS)
├── ai-agents/
│   ├── README.md           → AI agent system overview
│   ├── AGENT_ROUTING.md    → How agent routing works (NEW)
│   ├── AGENT_SETUP.md      → Setting up agents (consolidate existing)
│   └── ...
├── ios/                    → iOS-specific docs (CONSOLIDATE)
│   ├── README.md
│   └── ...
└── ...
```

### File Purpose Matrix

| File | Primary Audience | Content |
|------|------------------|---------|
| **CLAUDE.md** | Claude Code CLI | CLI permissions, workflow triggers, tool usage |
| **CODEX.md** | OpenAI cloud agent | OpenAI-specific instructions, capabilities |
| **GEMINI.md** | Gemini cloud agent | Gemini-specific instructions, capabilities |
| **ASTRID.md** | ALL AI agents | Project architecture, patterns, conventions, API contracts |
| **README.md** | Human developers | Project overview, setup, features |

### Implementation Steps

#### Step 2.1: Slim Down CLAUDE.md

Extract to keep only:
- Claude Code CLI configuration (`.claude/` setup)
- Permission patterns
- Workflow triggers ("let's fix stuff")
- Claude-specific tool usage
- Git workflow rules

Move to ASTRID.md:
- Project architecture overview
- Code patterns and conventions
- Testing guidelines
- API contracts
- Documentation rules

**Target:** ~250 lines (from 740+)

#### Step 2.2: Create New ASTRID.md Structure

```markdown
# Astrid Project Context

*AI agent context for the Astrid task management system*

## Project Overview
- Separate web and iOS repositories
- Tech stack summary

## Architecture
- Web: Next.js, React, Prisma
- iOS: SwiftUI, Core Data
- Shared: PostgreSQL, OAuth

## Code Patterns
- API route structure
- Component patterns
- Hook patterns
- iOS patterns

## Quality Standards
- Testing requirements
- Linting rules
- Pre-deploy checks

## API Contracts
- Key endpoints
- Authentication

## Development Workflow
- Branch naming
- Commit conventions
- PR process
```

#### Step 2.3: Create CODEX.md

```markdown
# OpenAI Codex Agent Context

*Configuration for OpenAI-powered coding agent*

## Agent Identity
- Email: codex@astrid.cc
- Service: OpenAI GPT-4o
- Capabilities: Code generation, review, GitHub operations

## Instructions
[OpenAI-specific prompting patterns]

## Tool Usage
[OpenAI function calling patterns]

## Also Read
- ASTRID.md for project context
```

#### Step 2.4: Create GEMINI.md

```markdown
# Gemini AI Agent Context

*Configuration for Google Gemini-powered coding agent*

## Agent Identity
- Email: gemini@astrid.cc
- Service: Gemini 1.5 Pro
- Capabilities: Code generation, review, GitHub operations

## Instructions
[Gemini-specific prompting patterns]

## Tool Usage
[Gemini function calling patterns]

## Also Read
- ASTRID.md for project context
```

#### Step 2.5: Rename GPT-5-CODEX.md → CODEX.md

```bash
git mv GPT-5-CODEX.md CODEX.md
```

#### Step 2.6: Consolidate iOS Documentation

Move scattered iOS docs to `docs/ios/`:
- `ios-app/*.md` → `docs/ios/` (keep README.md in ios-app/)
- Update cross-references

---

## Part 3: Implementation Order

### Phase 1: Agent Routing (Day 1)

1. [ ] Create `lib/ai-agent-config.ts`
2. [ ] Update `AIOrchestrator` type to include 'gemini'
3. [ ] Add `callGemini()` method to AIOrchestrator
4. [ ] Update routing in `ai-orchestration.service.ts`
5. [ ] Update `scripts/create-specific-ai-agents.ts`
6. [ ] Test routing with each agent type

### Phase 2: Documentation (Day 1-2)

1. [ ] Create new ASTRID.md with project context
2. [ ] Slim down CLAUDE.md to CLI-only
3. [ ] Rename GPT-5-CODEX.md → CODEX.md and update content
4. [ ] Create GEMINI.md
5. [ ] Update docs/README.md index
6. [ ] Consolidate iOS documentation

### Phase 3: Testing & Cleanup (Day 2)

1. [ ] Test agent assignment routing
2. [ ] Verify context file loading
3. [ ] Update any broken cross-references
4. [ ] Remove obsolete setup scripts
5. [ ] Update docs/ai-agents/README.md

---

## Migration Notes

### Email Rename: openai-codex@ → codex@

**Option A:** Database migration (recommended)
```sql
UPDATE "User" SET email = 'codex@astrid.cc' WHERE email = 'openai-codex@astrid.cc';
```

**Option B:** Support both emails in config
```typescript
export const AI_AGENT_CONFIG = {
  'codex@astrid.cc': { ... },
  'openai-codex@astrid.cc': { ... }, // backward compat
}
```

### Backward Compatibility

The centralized config approach maintains backward compatibility:
- Existing `claude@astrid.cc` assignments continue working
- `openai-codex@astrid.cc` can be aliased to new config
- No breaking changes to existing workflows

---

## Success Criteria

- [ ] All 3 agents (Claude, Codex, Gemini) can be assigned to tasks
- [ ] Each agent routes to correct API
- [ ] Context files load correctly per agent
- [ ] CLAUDE.md is focused on CLI usage (~250 lines)
- [ ] ASTRID.md contains comprehensive project context
- [ ] iOS documentation is consolidated
- [ ] docs/README.md index is updated

---

## Questions for Review

1. **Agent email naming:** Keep `codex@astrid.cc` or use `openai@astrid.cc`?
2. **Backward compat:** Support both old and new emails, or migrate?
3. **iOS docs:** Move all to `docs/ios/` or keep some in `ios-app/`?
4. **Context loading:** Should agents always load ASTRID.md + agent-specific, or make it configurable?

---

*Plan created: 2024-11-27*
*Ready for review and approval*
