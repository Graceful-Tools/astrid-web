// @vitest-environment node
/**
 * AWTD-1586: quick-add parses through astrid-core's browser build.
 *
 * The parity half drives the BROWSER package (packages/astrid-rules/web, instantiated from its own
 * .wasm bytes) through the same adapter parseTaskInput uses, over every case of the smart fixture,
 * and holds the result to the fixture's full web shape — the selected list appended, the day as an
 * instant — not just to the core's half. The fixture is generated from this repo's TypeScript
 * parser, so agreeing with it is agreeing with what the web did before.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as glue from '@/packages/astrid-rules/web/astrid_rules_wasm.js'
import * as smartParseCore from '@/lib/core-rules/smart-parse-core'
import { smartParseThroughCore } from '@/lib/core-rules/smart-parse-core'
import {
  browserCoreRules,
  loadBrowserCoreRules,
  resetBrowserCoreRulesForTests,
} from '@/lib/core-rules/browser'
import { parseTaskInput } from '@/lib/task-manager-utils'
import { isSystemListId } from '@/lib/list-permissions'
import type { TaskList } from '@/types/task'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

interface Fixture {
  now: string
  lists: Array<{ id: string; name: string; isVirtual: boolean }>
  cases: Array<{
    locale: string
    input: string
    selectedListId: string
    title: string
    listIds: string[]
    dueDate: string | null
    priority: number | null
    repeating: string | null
    weekdays: string[]
  }>
}

const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'smart.json'), 'utf8')) as Fixture
glue.initSync({ module: readFileSync(path.join(PACKAGE_DIR, 'web', 'astrid_rules_wasm_bg.wasm')) })
const cases = fixture.cases.map((c) => [`[${c.locale}] ${JSON.stringify(c.input)}`, c] as const)

describe('AWTD-1586: the browser build', () => {
  it('answers smartParse (it is in the browser rule set)', () => {
    expect(glue.kinds()).toContain('smartParse')
  })
})

describe('AWTD-1586: quick-add through the browser build makes the task the TypeScript made', () => {
  beforeAll(() => {
    vi.useFakeTimers({ now: new Date(fixture.now), toFake: ['Date'] })
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it.each(cases)('%s', (_name, c) => {
    const parsed = smartParseThroughCore({
      runJson: glue.runJson,
      input: c.input,
      selectedListId: c.selectedListId,
      lists: fixture.lists,
      locale: c.locale,
      now: new Date(),
      isVirtualListId: isSystemListId,
    })
    expect(parsed).not.toBeNull()
    const ts = parseTaskInput(c.input, c.selectedListId, undefined, fixture.lists as TaskList[], false, c.locale)
    expect({
      title: parsed!.title,
      listIds: parsed!.listIds,
      dueDay: parsed!.dueDateTime ? parsed!.dueDateTime.toISOString().slice(0, 10) : null,
      priority: parsed!.priority ?? null,
      repeating: parsed!.repeating ?? null,
      weekdays: parsed!.customRepeatingData?.weekdays ?? [],
    }).toEqual({
      title: c.title,
      listIds: c.listIds,
      dueDay: c.dueDate?.slice(0, 10) ?? null,
      priority: c.priority,
      repeating: c.repeating,
      weekdays: c.weekdays,
    })
    // The rest of the create payload matches the TypeScript's too.
    expect(parsed!.customRepeatingData).toEqual(ts.customRepeatingData)
    expect(parsed!.assigneeId).toBe(ts.assigneeId)
  })
})

describe('AWTD-1586: parseTaskInput routes through the door only when it is loaded', () => {
  afterEach(() => resetBrowserCoreRulesForTests())
  const lists = fixture.lists as TaskList[]

  it('keeps the TypeScript while nothing is loaded (the default, and the server)', () => {
    expect(browserCoreRules()).toBeNull()
    expect(parseTaskInput('Milk tomorrow', 'inbox', undefined, lists).title).toBe('Milk')
  })

  it('asks core smartParse once the door is loaded', () => {
    const runJson = vi.fn(glue.runJson)
    resetBrowserCoreRulesForTests({ runJson, answers: (k) => k === 'smartParse' }, { smartParse: smartParseCore })
    const parsed = parseTaskInput('Milk tomorrow', 'inbox', undefined, lists)
    expect(runJson).toHaveBeenCalledTimes(1)
    expect(JSON.parse(runJson.mock.calls[0][0]).kind).toBe('smartParse')
    expect(parsed.title).toBe('Milk')
  })

  it('leaves "assign to" / "for" (D13, web-only) to the TypeScript', () => {
    const runJson = vi.fn(glue.runJson)
    resetBrowserCoreRulesForTests({ runJson, answers: () => true }, { smartParse: smartParseCore })
    parseTaskInput('Call mom for jon', 'inbox', { user: { id: 'u1' } }, lists)
    expect(runJson).not.toHaveBeenCalled()
  })

  it('falls back when the build does not answer smartParse, or answers with an error', () => {
    const runJson = vi.fn(() => JSON.stringify({ ok: false, error: { kind: 'badRequest' } }))
    resetBrowserCoreRulesForTests({ runJson, answers: () => false }, { smartParse: smartParseCore })
    expect(parseTaskInput('Milk tomorrow', 'inbox', undefined, lists).title).toBe('Milk')
    expect(runJson).not.toHaveBeenCalled()
    resetBrowserCoreRulesForTests({ runJson, answers: () => true }, { smartParse: smartParseCore })
    expect(parseTaskInput('Milk tomorrow', 'inbox', undefined, lists).title).toBe('Milk')
    expect(runJson).toHaveBeenCalledTimes(1)
  })
})

describe('AWTD-1586: the loader', () => {
  afterEach(() => resetBrowserCoreRulesForTests())

  it('never requests the module while the flag is off', async () => {
    const load = vi.fn()
    expect(await loadBrowserCoreRules({ enabled: false, load })).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('resolves null, never rejects, when the module fails to load', async () => {
    const load = vi.fn(() => Promise.reject(new Error('network')))
    expect(await loadBrowserCoreRules({ enabled: true, load })).toBeNull()
    expect(browserCoreRules()).toBeNull()
  })

  it('loads once and exposes the door with the kinds the build answers', async () => {
    const init = vi.fn(() => Promise.resolve())
    const load = vi.fn(() => Promise.resolve({ default: init, runJson: glue.runJson, kinds: glue.kinds }))
    const [a, b] = await Promise.all([
      loadBrowserCoreRules({ enabled: true, load }),
      loadBrowserCoreRules({ enabled: true, load }),
    ])
    expect(load).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(browserCoreRules()?.answers('smartParse')).toBe(true)
    expect(browserCoreRules()?.answers('renderMarkdown')).toBe(false)
  })
})
