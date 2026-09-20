/**
 * AWTD-975: the scheduled /fixall loop must be able to CALL the board, and must
 * say so out loud when it cannot.
 *
 * The first unattended web run (2026-09-19) worked its task and logged
 * `RESULT: OK`. Every `mcp__astrid__*` call in it was denied — there is no
 * terminal to grant a permission prompt in — so it fell back to the OAuth
 * scripts for reading the queue, reading tasks, commenting and completing. That
 * fallback works, which is why nobody noticed, but it CANNOT see `attention`:
 * the inbox added in AWTD-963 arrives only on `get_agent_queue`. A loop that
 * cannot hear what is said to it was the exact failure AWTD-963 existed to fix.
 *
 * SILENT DEGRADATION IS WHY THIS IS A TEST AND NOT A PARAGRAPH. The run did not
 * crash, did not warn, and reported success. Nothing about the log distinguished
 * a loop reading the board from one talking past it.
 *
 * Two halves, because the settings live in two places:
 *
 *   - `.claude/settings.json.example` is checked in and is the only copy a fresh
 *     checkout inherits (`.claude/settings.local.json` is gitignored —
 *     .claude/README.md). This test holds the template.
 *   - The LOCAL file is what the loop actually reads, and no test can see the
 *     machine it will run on. `fixall-loop.sh` checks that itself at startup,
 *     and this test holds it to doing so.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { OAUTH_MCP_TOOLS } from '../../mcp/tool-definitions'
import {
  BOARD_TOOLS_THE_LOOP_NEEDS,
  checkBoardPermissions,
  allowedToolsIn,
} from '../../scripts/check-board-permissions'

const ROOT = process.cwd()
const TEMPLATE = '.claude/settings.json.example'
const LOOP = 'scripts/fixall-loop.sh'

const template = readFileSync(join(ROOT, TEMPLATE), 'utf8')
const loop = readFileSync(join(ROOT, LOOP), 'utf8')

describe('the scheduled loop can call the board (AWTD-975)', () => {
  it('names only tools the MCP server actually defines', () => {
    // A typo fails EXACTLY like a missing entry: denial, silent fallback,
    // `RESULT: OK`. So "is this a real tool name" is worth checking by machine
    // rather than by proofreading.
    const real = new Set(OAUTH_MCP_TOOLS.map(tool => `mcp__astrid__${tool.name}`))
    const unknown = BOARD_TOOLS_THE_LOOP_NEEDS.filter(entry => !real.has(entry))

    expect(unknown, 'these are not tools mcp/tool-definitions.ts advertises').toEqual([])
  })

  it('pre-approves every one of them in the checked-in template', () => {
    const allowed = allowedToolsIn(template)
    const missing = BOARD_TOOLS_THE_LOOP_NEEDS.filter(entry => !allowed.includes(entry))

    expect(
      missing,
      `${TEMPLATE} is the only permissions copy a fresh checkout inherits. ` +
        'Without these the scheduled loop falls back to the OAuth scripts and ' +
        'goes deaf to `attention`, while still logging RESULT: OK.',
    ).toEqual([])
  })

  it('names them individually rather than by wildcard', () => {
    // A wildcard would also pre-approve whatever is added to that server later.
    // The ask is the board tools, not a standing grant.
    const wildcards = allowedToolsIn(template).filter(
      entry => entry.startsWith('mcp__astrid__') && entry.includes('*'),
    )

    expect(wildcards).toEqual([])
  })

  it('does not buy the permissions back with bypassPermissions', () => {
    // That pre-approves every tool including Bash. Deliberately rejected when
    // this was filed: the ask is the board tools, not the guard rails.
    const mode = loop.match(/--permission-mode\s+"?\$\{FIXALL_PERMISSION_MODE:-(\w+)\}/)

    expect(mode?.[1], `${LOOP} must default to acceptEdits`).toBe('acceptEdits')
  })

  it('checks the LOCAL settings file at startup, since no test can see it', () => {
    expect(
      loop,
      `${LOOP} must run scripts/check-board-permissions.ts before starting a ` +
        'session: .claude/settings.local.json is gitignored, so a green ' +
        'template says nothing about the machine the loop runs on.',
    ).toMatch(/check-board-permissions\.ts/)
  })

  it('warns rather than skipping when the local file is short', () => {
    // Degraded is still better than not running: the fallback path works for
    // everything but `attention`. A skip would turn one missing line in a
    // gitignored file into a loop that never runs at all.
    const after = loop.slice(loop.indexOf('check-board-permissions.ts'))
    const nextSection = after.indexOf('\n# ──')
    const block = nextSection === -1 ? after : after.slice(0, nextSection)

    expect(block, 'the startup check must warn and carry on').not.toMatch(
      /RESULT: (SKIPPED|FAILED)/,
    )
    // …and it must be bounded, or the assertion above is searching the rest of
    // the file and would pass on anything.
    expect(nextSection).toBeGreaterThan(0)
  })
})

describe('the startup check itself (AWTD-975)', () => {
  it('passes a settings file that grants every board tool', () => {
    const result = checkBoardPermissions(template)

    expect(result.missing).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('reports what is missing rather than passing by matching nothing', () => {
    const stripped = JSON.stringify({
      permissions: { allow: ['Bash(git *)', 'mcp__astrid__get_task'] },
    })
    const result = checkBoardPermissions(stripped)

    expect(result.ok).toBe(false)
    expect(result.missing).toContain('mcp__astrid__get_agent_queue')
    expect(result.missing).not.toContain('mcp__astrid__get_task')
  })

  it('treats an unparseable settings file as a finding, not as a pass', () => {
    // The `--fix` path in validate-settings.ts once wrote an unterminated
    // string here. A checker that threw, or that read `{}` as "nothing
    // missing", would have called that file healthy.
    const result = checkBoardPermissions('{ "permissions": { "allow": [')

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([...BOARD_TOOLS_THE_LOOP_NEEDS])
    expect(result.problem).toMatch(/could not be parsed/i)
  })

  it('reads a settings file that carries comments and trailing commas', () => {
    // The template is JSON-with-comments and so, usually, is the local file.
    expect(template).toMatch(/^\s*\/\//m)
    expect(checkBoardPermissions(template).ok).toBe(true)
  })
})
