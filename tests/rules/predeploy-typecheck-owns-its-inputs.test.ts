/**
 * AWTD-1245 — the TypeScript gate must not read generated files it does not own.
 *
 * `tsconfig.json` includes `.next/types/**` and `next-env.d.ts` imports
 * `./.next/types/routes.d.ts`, so `tsc --noEmit` type-checks GENERATED route
 * types. In predeploy those types were produced by the `Build` gate — which
 * runs LAST, fifteen places after `TypeScript`. So the gate read whatever the
 * previous build left behind, from any branch or any `next dev` session.
 *
 * What that cost, twice: AWTD-839 deleted `app/api/user/mcp-settings/route.ts`,
 * a `.next` built before the deletion still listed the route, and the gate
 * failed with
 *
 *   .next/types/validator.ts(1704,39): error TS2307: Cannot find module
 *     '../../app/api/user/mcp-settings/route.js'
 *
 * on a tree where `tsc` was in fact clean — the same run's `Build` regenerated
 * the types correctly a few gates later. It filed a "Predeploy Failed:
 * TypeScript" task on 2026-10-12 and again on 2026-10-13, and the second one
 * held up a production deploy while the false alarm was disproved.
 *
 * The trap for anyone fixing it: `rm -rf .next` makes it WORSE. With no
 * `.next/types/routes.d.ts` at all, `next-env.d.ts`'s import fails and the gate
 * goes red for a third reason. So the fix is not "clean", it is "generate" —
 * `next typegen` produces exactly these files without a full build, in about
 * half a second.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** The predeploy check definition whose `name` is given. */
function gate(name: string): string {
  const source = read('scripts/predeploy-self-healing.ts')
  const marker = `name: '${name}',`
  const start = source.indexOf(marker)
  expect(start, `predeploy has no '${name}' gate`).toBeGreaterThan(-1)
  // From the name to the end of that object literal.
  const rest = source.slice(start)
  const end = rest.indexOf('\n    },')
  return rest.slice(0, end === -1 ? 400 : end)
}

describe('the TypeScript gate generates the types it checks (AWTD-1245)', () => {
  it('still has the dependency this test is about', () => {
    // If these change, the premise changes and the rest of this file should be
    // re-read rather than trusted.
    const tsconfig = read('tsconfig.json')
    expect(tsconfig).toContain('.next/types/**/*.ts')
    expect(read('next-env.d.ts')).toContain('.next/types/routes.d.ts')
  })

  it('does not run a bare tsc that reads a previous build’s output', () => {
    const typescript = gate('TypeScript')
    expect(
      typescript,
      'the TypeScript gate runs bare tsc, so it reads .next/types left by ' +
        'whatever built last — the stale-artifact false red of AWTD-1245',
    ).not.toMatch(/command:\s*'npx tsc --noEmit'/)
  })

  it('regenerates route types before type-checking them', () => {
    // Either the gate does it inline, or the script it calls does.
    const typescript = gate('TypeScript')
    const command = /command:\s*'([^']+)'/.exec(typescript)?.[1] ?? ''
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    const resolved = command.startsWith('npm run ')
      ? (scripts[command.slice('npm run '.length)] ?? '')
      : command

    expect(
      `${command} || ${resolved}`,
      'the gate must generate route types (next typegen) before tsc reads them',
    ).toMatch(/typegen/)
  })

  it('generates before it checks, not after', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    const typecheck = scripts.typecheck ?? ''
    if (/typegen/.test(typecheck)) {
      expect(typecheck.indexOf('typegen')).toBeLessThan(typecheck.indexOf('tsc'))
    }
  })

  it('fixes it for every caller of npm run typecheck, not just predeploy', () => {
    // Three workflows run `npm run typecheck`, including the `quality-gates`
    // job in production-deployment.yml — which is the gate that now licenses a
    // deploy (AWTD-1250). A fix that lived only in predeploy would leave the
    // deploy gate reading stale generated types.
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    expect(scripts.typecheck, 'npm run typecheck must own its inputs too').toMatch(/typegen/)
  })
})
