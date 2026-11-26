// @vitest-environment node
/**
 * ADEV-307: the board's columns ask core `board` through the browser build.
 *
 * The door's own loader installs the hook; every configuration of the board fixture must give the
 * fixture's columns, each asked of the core, and drops stay TypeScript. With no door (flag off),
 * or a build that does not list `board`, the TypeScript answers as before.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as glue from '@/packages/astrid-rules/web/astrid_rules_wasm.js'
import { setBoardCore } from '@/lib/board-core-hook'
import { loadBrowserCoreRules, resetBrowserCoreRulesForTests } from '@/lib/core-rules/browser'
import { installBrowserBoard } from '@/lib/core-rules/browser-board'
import { getProjectBoardColumns } from '@/lib/project-status'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')
const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'board.json'), 'utf8')) as {
  configurations: Array<{ name: string; customStates: unknown; columns: unknown[] }>
}
glue.initSync({ module: readFileSync(path.join(PACKAGE_DIR, 'web', 'astrid_rules_wasm_bg.wasm')) })

describe('ADEV-307: board columns through the browser build', () => {
  afterEach(() => {
    setBoardCore(null)
    resetBrowserCoreRulesForTests()
  })

  it('the browser build answers board', () => {
    expect(glue.kinds()).toContain('board')
  })

  it('a build that does not list board installs nothing', () => {
    expect(installBrowserBoard({ runJson: glue.runJson, answers: () => false })).toBe(false)
  })

  it('the lazy load installs the hook, and every configuration is asked of the core', async () => {
    const runJson = vi.fn((request: string) => glue.runJson(request))
    const door = await loadBrowserCoreRules({
      enabled: true,
      load: async () => ({ default: async () => undefined, runJson, kinds: () => glue.kinds() }),
    })
    expect(door).not.toBeNull()
    for (const configuration of fixture.configurations) {
      runJson.mockClear()
      expect(getProjectBoardColumns(configuration.customStates), configuration.name).toEqual(configuration.columns)
      expect(runJson, configuration.name).toHaveBeenCalledTimes(1)
    }
  })

  it('a door that fails to answer leaves the TypeScript columns', () => {
    installBrowserBoard({ runJson: () => JSON.stringify({ ok: false, error: { kind: 'x' } }), answers: () => true })
    const first = fixture.configurations[0]
    expect(getProjectBoardColumns(first.customStates)).toEqual(first.columns)
  })
})
