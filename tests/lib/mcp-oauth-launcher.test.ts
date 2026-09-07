/**
 * The Astrid MCP server was unusable from Claude Code, and every failure on the
 * way to fixing it was SILENT — which is why the repo's own /fixstuff and
 * /fixall commands document `get_agent_queue` while every run falls back to
 * scripts. Each case below is one of those failures:
 *
 *  1. `npm run build:mcp:oauth` compiled to `dist/mcp/` (both servers import
 *     `../lib/*`, so tsc infers the repo root as the root of the input set) but
 *     the script looked in `dist/` and reported "Compilation failed" for a
 *     compile that had succeeded.
 *  2. The launcher used `require(SERVER)`, but the server self-starts only
 *     under `require.main === module`. It loaded, started nothing, and exited
 *     0 — an MCP client sees a server that connects and offers no tools.
 *  3. dotenv's startup banner goes to STDOUT, which is the JSON-RPC channel for
 *     the stdio transport, corrupting the first frame.
 *
 * So this test does the only thing that would have caught all three: build,
 * spawn the launcher exactly as an MCP client does, and speak MCP to it.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const LAUNCHER = join(ROOT, 'mcp', 'astrid-mcp-launch.js')
const BUILT_SERVER = join(ROOT, 'dist', 'mcp', 'mcp-server-oauth.js')

const frame = (msg: unknown) => `${JSON.stringify(msg)}\n`

const HANDSHAKE =
  frame({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1' },
    },
  }) +
  frame({ jsonrpc: '2.0', method: 'notifications/initialized' }) +
  frame({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

describe('Astrid MCP stdio server is launchable by an MCP client', () => {
  beforeAll(() => {
    // Build output is gitignored, so a clean checkout (and CI) has none. This
    // is also case 1's assertion: the build must leave the server exactly where
    // the launcher looks for it, or it "succeeds" and nothing is runnable.
    execFileSync('npm', ['run', 'build:mcp:oauth'], { cwd: ROOT, stdio: 'pipe' })
    expect(existsSync(BUILT_SERVER), `build did not produce ${BUILT_SERVER}`).toBe(true)
  }, 180_000)

  it('compiles with a tsc invocation TypeScript 6 accepts', () => {
    // TS6 rejects command-line input files while a tsconfig.json is in scope
    // (TS5112), and node10 resolution is a hard error (TS5107). Both broke the
    // build outright; keep the flags that fix them.
    const script = readFileSync(join(ROOT, 'mcp', 'build-mcp-oauth.js'), 'utf8')
    expect(script).toContain('--ignoreConfig')
    expect(script).not.toMatch(/--moduleResolution node\b(?!16)/)
  })

  it('answers initialize and advertises the agent-queue tool over stdio', () => {
    const proc = spawnSync('node', [LAUNCHER], {
      cwd: ROOT,
      input: HANDSHAKE,
      encoding: 'utf8',
      timeout: 60_000,
    })

    // Case 2: a server that starts nothing exits 0 with an empty stdout, so an
    // exit code alone proves nothing — the response has to be there.
    const lines = proc.stdout.split('\n').filter((l) => l.trim() !== '')
    expect(lines.length, `no JSON-RPC output; stderr:\n${proc.stderr}`).toBeGreaterThan(0)

    // Case 3: every stdout line must be a JSON-RPC frame. A banner on stdout
    // fails here rather than corrupting a real client's session.
    for (const line of lines) {
      expect(
        () => JSON.parse(line),
        `non-JSON on the JSON-RPC channel: ${line.slice(0, 120)}`
      ).not.toThrow()
    }

    const responses = lines.map((l) => JSON.parse(l))
    const initialize = responses.find((r) => r.id === 1)
    expect(initialize?.result?.serverInfo?.name).toBe('astrid-task-manager-oauth')

    // The queue tool is what /fixstuff and /fixall actually call. It went
    // missing from a stale committed bundle once before (task 979e1325).
    const toolNames = responses.find((r) => r.id === 2)?.result?.tools?.map(
      (t: { name: string }) => t.name
    )
    expect(toolNames).toContain('get_agent_queue')
    expect(toolNames).toContain('add_comment')
  }, 90_000)
})
