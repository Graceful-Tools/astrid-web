/**
 * AWTD-1342: lib/ai/response-parser.ts had no test.
 *
 * Pinned:
 *   - extractBalancedJson finds the object whose braces balance, ignoring braces
 *     inside JSON strings and honouring escaped quotes and escaped backslashes;
 *   - it returns null for an object without "files" or with unbalanced braces;
 *   - countBraceBalance counts only structural braces;
 *   - mapToKnownPath keeps exact and unknown paths, maps the kebab/camel twin,
 *     and does not map onto the wrong file (AWTD-1347).
 */

import { describe, it, expect } from 'vitest'
import {
  countBraceBalance,
  extractBalancedJson,
  mapToKnownPath,
  parseGeneratedCode,
  parseImplementationPlan,
} from '@/lib/ai/response-parser'

describe('extractBalancedJson (AWTD-1342)', () => {
  it('extracts the object from surrounding prose', () => {
    const json = '{"files":[{"path":"a.ts","content":"x"}]}'
    expect(extractBalancedJson(`Here you go:\n${json}\nThanks!`)).toBe(json)
  })

  it('ignores braces inside strings', () => {
    const json = '{"files":[{"path":"a.ts","content":"function f() { return {} }}}"}]}'
    const out = extractBalancedJson(`prefix ${json} suffix }`)
    expect(out).toBe(json)
    expect(JSON.parse(out!).files[0].content).toBe('function f() { return {} }}}')
  })

  it('an escaped quote does not end the string, so a brace after it stays inside', () => {
    const json = String.raw`{"files":[{"path":"a.ts","content":"say \"}\" now"}]}`
    expect(extractBalancedJson(`${json} trailing`)).toBe(json)
  })

  it('an escaped backslash before a quote does end the string', () => {
    const json = String.raw`{"files":[{"path":"a.ts","content":"C:\\"},{"path":"b.ts","content":"{"}]}`
    const out = extractBalancedJson(json)
    expect(out).toBe(json)
    expect(JSON.parse(out!).files.map((f: { path: string }) => f.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('returns null without a "files" key, without braces, or when they never balance', () => {
    expect(extractBalancedJson('{"summary":"no files"}')).toBeNull()
    expect(extractBalancedJson('plain text')).toBeNull()
    expect(extractBalancedJson('{"files":[{"path":"a.ts"}]')).toBeNull()
  })

  /**
   * AWTD-1347 (found by AWTD-1342): the scan was anchored at the FIRST `{` in
   * the response. When that first object is not the payload (prose such as
   * "use {braces}" or an example object), the depth returned to 0 without
   * "files", the loop kept going, and the next balance point returned
   * response.substring(firstBrace, end) — prose and both objects glued together,
   * which is not JSON. The extractor restarts at the next `{` instead.
   */
  it('AWTD-1347: finds the payload when an earlier, unrelated object precedes it', () => {
    const json = '{"files":[{"path":"a.ts","content":"x"}]}'
    expect(extractBalancedJson(`Wrap options in {braces}. Result: ${json}`)).toBe(json)
    expect(extractBalancedJson(`Example: {"a":{"b":1}} then } and ${json}`)).toBe(json)
  })
})

describe('countBraceBalance (AWTD-1342)', () => {
  it('is zero for balanced JSON and counts only structural braces', () => {
    expect(countBraceBalance('{"a":{"b":"}}}"}}')).toBe(0)
    expect(countBraceBalance('{"a":{"b":"{"')).toBe(2)
    expect(countBraceBalance('}}')).toBe(-2)
  })

  it('treats an escaped quote as content, not a string terminator', () => {
    expect(countBraceBalance(String.raw`{"a":"\"{"`)).toBe(1)
    expect(countBraceBalance(String.raw`{"a":"\\"}`)).toBe(0)
  })

  it('reports a truncated response as positive balance', () => {
    const full = '{"files":[{"path":"a.ts","content":"x"}]}'
    expect(countBraceBalance(full.slice(0, -2))).toBe(1)
  })
})

describe('parseGeneratedCode (AWTD-1342)', () => {
  it('recovers the files from prose-wrapped JSON', () => {
    const json = { files: [{ path: 'a.ts', content: 'const a = "}"', action: 'modify' }], commitMessage: 'c', prTitle: 't', prDescription: 'd' }
    expect(parseGeneratedCode(`Sure!\n${JSON.stringify(json)}\nDone.`)).toEqual(json)
  })

  it('signals a format retry when nothing parses', () => {
    expect(() => parseGeneratedCode('I could not do it.')).toThrow('RETRY_WITH_FORMAT_ENFORCEMENT')
  })
})

describe('mapToKnownPath (AWTD-1342)', () => {
  const known = ['hooks/useTaskOperations.ts', 'components/task-card.tsx', 'lib/utils.ts']

  it('keeps an exact match', () => {
    expect(mapToKnownPath('lib/utils.ts', known)).toBe('lib/utils.ts')
  })

  it('maps the kebab-case twin of an explored camelCase file, and back', () => {
    expect(mapToKnownPath('hooks/use-task-operations.ts', known)).toBe('hooks/useTaskOperations.ts')
    expect(mapToKnownPath('components/TaskCard.tsx', known)).toBe('components/task-card.tsx')
  })

  it('keeps a path that matches nothing explored (a new file)', () => {
    expect(mapToKnownPath('lib/new-thing.ts', known)).toBe('lib/new-thing.ts')
    expect(mapToKnownPath('lib/utils.ts', [])).toBe('lib/utils.ts')
  })

  it('does not map across extensions it does not strip', () => {
    expect(mapToKnownPath('styles/utils.css', known)).toBe('styles/utils.css')
  })

  /**
   * AWTD-1347 (found by AWTD-1342): the match was on base name alone, with the
   * directory ignored, and the FIRST hit won. In a Next.js repo base names like
   * page.tsx / route.ts / index.ts repeat in every directory, so a plan naming a
   * new `app/settings/page.tsx` was rewritten onto whichever explored page.tsx
   * came first — and parseImplementationPlan hands that path to code
   * generation, which then overwrote the wrong file.
   */
  it('AWTD-1347: does not rewrite a new file onto an unrelated explored file with the same base name', () => {
    expect(mapToKnownPath('app/settings/page.tsx', ['app/lists/page.tsx'])).toBe('app/settings/page.tsx')
    expect(mapToKnownPath('components/index.ts', ['lib/index.ts'])).toBe('components/index.ts')
  })

  it('AWTD-1347: does not pick arbitrarily between several explored files with the same base name', () => {
    const twins = ['app/api/tasks/route.ts', 'app/api/lists/route.ts']
    expect(mapToKnownPath('app/api/comments/route.ts', twins)).toBe('app/api/comments/route.ts')
    expect(mapToKnownPath('src/Button.tsx', ['components/Button.tsx', 'ui/button.tsx'])).toBe('src/Button.tsx')
  })

  it('AWTD-1347: prefers the candidate sharing the longest folder suffix, whatever the order', () => {
    const known = ['app/lists/page.tsx', 'app/settings/page.tsx', 'app/admin/settings/page.tsx']
    expect(mapToKnownPath('src/app/settings/page.tsx', known)).toBe('app/settings/page.tsx')
    expect(mapToKnownPath('admin/settings/page.tsx', known)).toBe('app/admin/settings/page.tsx')
    expect(mapToKnownPath('src/hooks/use-task-operations.ts', ['lib/useTaskOperations.ts', 'hooks/useTaskOperations.ts']))
      .toBe('hooks/useTaskOperations.ts')
  })

  it('AWTD-1347: still maps a distinctive file the AI put in the wrong folder, when it is the only one', () => {
    expect(mapToKnownPath('src/task-card.tsx', ['components/task-card.tsx'])).toBe('components/task-card.tsx')
  })

  it('parseImplementationPlan routes plan paths through it', () => {
    const plan = parseImplementationPlan('Modify `hooks/use-task-operations.ts` to fix it.', known)
    expect(plan.files.map(f => f.path)).toEqual(['hooks/useTaskOperations.ts'])
  })
})
