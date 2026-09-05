/**
 * RED for task 390bccc3.
 *
 * The stdio MCP modules each constructed their own PrismaClient, which bypassed
 * the $extends hook in lib/prisma.ts that watches for an assignee change and
 * dispatches the AI agent. So assigning a task to an agent through MCP never
 * started the agent — the single feature MCP exists to serve. Each module also
 * opened its own connection pool.
 *
 * Because `require("@prisma/client")` produced an untyped client, it also hid
 * real runtime bugs: a wrong model name, reads through a nullable relation, and
 * use of the admins/members relations dropped from the schema.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const MCP_MODULES = [
  'mcp/handlers/tasks.ts',
  'mcp/handlers/lists.ts',
  'mcp/handlers/comments.ts',
  'mcp/access-token-validator.ts',
  'mcp/mcp-server-v2.ts',
]

describe.each(MCP_MODULES)('%s', file => {
  const source = fs.readFileSync(file, 'utf8')

  it('uses the shared extended client, not its own', () => {
    expect(source).not.toMatch(/new PrismaClient\(/)
    expect(source).toMatch(/from ["']\.\.?\/(\.\.\/)?lib\/prisma["']/)
  })
})

describe('bugs the untyped client was hiding', () => {
  it('uses the real MCPToken model name', () => {
    for (const file of ['mcp/handlers/lists.ts', 'mcp/access-token-validator.ts']) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source).not.toContain('prisma.mcpToken')
      expect(source).toContain('prisma.mCPToken')
    }
  })

  it('no longer reads the admins/members relations dropped from the schema', () => {
    const source = fs.readFileSync('mcp/handlers/lists.ts', 'utf8')

    expect(source).not.toMatch(/list\.admins\./)
    expect(source).not.toMatch(/list\.members\./)
  })

  it('validates MCP tokens with the shared hash-or-plaintext lookup', () => {
    for (const file of ['mcp/handlers/lists.ts', 'mcp/access-token-validator.ts']) {
      expect(fs.readFileSync(file, 'utf8')).toContain('mcpTokenLookup(')
    }
  })
})

describe('MCP comments run the shared side effects', () => {
  it('dispatches them rather than only writing the row', () => {
    const source = fs.readFileSync('mcp/handlers/comments.ts', 'utf8')

    expect(source).toContain('dispatchPostCommentSideEffects')
  })
})
