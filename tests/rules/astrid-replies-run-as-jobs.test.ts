/**
 * RULE — an Astrid model call is a durable job, never a floating promise (AWTD-1460).
 *
 * lib/astrid-handoff.ts and lib/comments/post-comment-side-effects.ts used to
 * start `processAstridMessage(…)` / `processAstridComment(…)` and walk away
 * with `.catch(log)`. On Vercel a function is frozen once its response is
 * flushed (lib/background.ts), so a reply that took longer than the response
 * simply never arrived, and nothing retried it. They now enqueue an
 * `astrid-handoff` / `astrid-comment-reply` job (lib/jobs/), and the only
 * code that calls the runtime is that job's handler, which awaits it.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED = ['app', 'lib', 'services', 'mcp']
const RUNTIME = 'lib/astrid-agent-runtime.ts'
const HANDLERS = 'lib/jobs/handlers.ts'

function files(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out = out.concat(files(full))
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full)
  }
  return out
}

const sources = SCANNED.flatMap(d => files(join(ROOT, d))).map(f => ({
  path: relative(ROOT, f),
  // Comments mention these names in prose; only code counts.
  code: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
}))

/** Each call's text through its closing paren and whatever is chained on it. */
function calls(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(/processAstrid(?:Message|Comment)\s*\(/g)) {
    let depth = 0
    let i = m.index! + m[0].length - 1
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++
      else if (code[i] === ')' && --depth === 0) break
    }
    out.push(code.slice(m.index!, i + 20))
  }
  return out
}

describe('Astrid replies run as jobs (AWTD-1460)', () => {
  it('no processAstrid* call is left floating with .catch(', () => {
    const offenders = sources.flatMap(s =>
      calls(s.code)
        .filter(c => /\)\s*\.catch\s*\(/.test(c))
        .map(() => s.path),
    )
    expect(offenders).toEqual([])
  })

  it('only the job handler calls the Astrid runtime, and it awaits it', () => {
    const callers = sources
      .filter(s => s.path !== RUNTIME && calls(s.code).some(c => !/^processAstrid\w+\s*\(\s*params\s*\)/.test(c)))
      .map(s => s.path)
    expect(callers).toEqual([HANDLERS])

    const handlers = sources.find(s => s.path === HANDLERS)!.code
    for (const m of handlers.matchAll(/(\S+)\s+processAstrid(?:Message|Comment)\s*\(/g)) expect(m[1]).toBe('await')
  })

  it('the call sites enqueue the two kinds', () => {
    const handoff = sources.find(s => s.path === 'lib/astrid-handoff.ts')!.code
    const comments = sources.find(s => s.path === 'lib/comments/post-comment-side-effects.ts')!.code
    expect(handoff).toMatch(/enqueueJob\(\s*'astrid-handoff'/)
    expect(comments).toMatch(/enqueueJob\(\s*'astrid-comment-reply'/)
  })
})
