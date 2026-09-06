/**
 * RED for task 979e1325 — mcp/astrid-mcp and mcp/astrid-mcp-oauth were
 * compiled bundles committed at the initial open-source release and never
 * rebuilt, while their TypeScript sources kept changing.
 *
 * This is not hypothetical drift. The committed OAuth bundle contains no
 * `get_agent_queue` tool at all — the tool the entire /fixall loop is built on
 * — because it predates it. Anyone who ran the checked-in executable got a
 * server missing tools their source tree clearly has.
 *
 * A compiled artifact that silently disagrees with its source is worse than no
 * artifact: `npm run build:mcp:oauth` regenerates both in seconds.
 */
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('no compiled MCP bundles are committed (task 979e1325)', () => {
  it('tracks no build output under mcp/', () => {
    const tracked = execSync('git ls-files mcp/', { encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)

    // Sources, schemas and the build script are fine; compiled bundles are not.
    const bundles = tracked.filter(
      (f) => /^mcp\/[^/]+$/.test(f) && !/\.(ts|js|md|json|mjs|cjs)$/.test(f)
    )

    expect(
      bundles,
      `compiled bundles are committed and will drift from their sources: ${bundles.join(', ')}`
    ).toEqual([])
  })
})
