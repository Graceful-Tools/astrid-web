/**
 * Task ff74f430: docs drift. scripts/check-doc-links.ts validated Markdown
 * links only, so nothing checked the far more common form — a path written as
 * inline code in prose or a reference table. That is how ASTRID.md came to
 * point at `lib/ai-agent-config.ts` (real path: `lib/ai/agent-config.ts`) and
 * how docs/context/conventions.md came to cite three files that do not exist.
 *
 * The last two cases here are the regression: they fail against the docs as
 * they were filed, and only pass once the drift is actually fixed.
 */
import { describe, it, expect } from 'vitest'
import {
  extractCodePathReferences,
  stripFencedBlocks,
  normalizeCodePath,
  findBrokenCodePaths,
  AUTHORITATIVE_DOCS,
} from '@/scripts/lib/doc-code-paths'

describe('extractCodePathReferences (task ff74f430)', () => {
  it('finds a path written as inline code in prose', () => {
    expect(extractCodePathReferences('See `lib/ai/agent-config.ts` for routing.'))
      .toEqual([{ path: 'lib/ai/agent-config.ts', line: 1 }])
  })

  it('finds paths in a table cell, which is where reference drift hides', () => {
    const table = '| File | Purpose |\n|---|---|\n| `lib/quick-add.ts` | Rules |'
    expect(extractCodePathReferences(table)).toEqual([{ path: 'lib/quick-add.ts', line: 3 }])
  })

  it('reports the line the path is on so a failure is actionable', () => {
    expect(extractCodePathReferences('intro\n\nsee `lib/env.ts`')[0].line).toBe(3)
  })

  it('strips a trailing line reference, which is not part of the path', () => {
    expect(normalizeCodePath('lib/env.ts:130')).toBe('lib/env.ts')
    expect(normalizeCodePath('ASTRID.md:141-150')).toBe('ASTRID.md')
    expect(extractCodePathReferences('see `lib/env.ts:130`')[0].path).toBe('lib/env.ts')
  })

  it('ignores fenced blocks, which hold snippets and ASCII trees rather than paths', () => {
    const source = 'prose `lib/env.ts`\n```\napp/api/[resource]/route.ts\n├── auth.ts\n```\n'
    expect(extractCodePathReferences(source).map(r => r.path)).toEqual(['lib/env.ts'])
  })

  it('keeps line numbers correct across a stripped fence', () => {
    expect(stripFencedBlocks('a\n```\nb\n```\nc').split('\n')).toHaveLength(5)
  })

  it('ignores the things that merely look like paths', () => {
    const notPaths = [
      '`app/api/[resource]/route.ts`',            // a placeholder segment
      '`npm test tests/lib/base-url.test.ts`',    // a command line
      '`/.well-known/ai-plugin.json`',            // a URL route
      '`~/.config/Claude/config.json`',           // the reader\'s home directory
      '`https://astrid.cc/api/v1/tasks`',         // a URL
      '`@/components/ui/button`',                 // an import specifier
      '`node_modules/.bin/tsx`',                  // not committed
      '`dist/mcp-server-oauth.js`',               // build output
      '`useTaskOperations`',                      // no slash: an identifier
    ]
    for (const source of notPaths) {
      expect(extractCodePathReferences(source), source).toEqual([])
    }
  })
})

describe('the authoritative docs cite paths that exist (task ff74f430)', () => {
  it('checks a set that covers the docs agents are told to trust', () => {
    expect(AUTHORITATIVE_DOCS).toContain('ASTRID.md')
    expect(AUTHORITATIVE_DOCS).toContain('docs/ARCHITECTURE.md')
    expect(AUTHORITATIVE_DOCS).toContain('docs/context/conventions.md')
  })

  it('has no broken code path in any of them', () => {
    const broken = findBrokenCodePaths(process.cwd())
    expect(broken.map(p => `${p.file}:${p.line} -> ${p.path}`)).toEqual([])
  })
})
