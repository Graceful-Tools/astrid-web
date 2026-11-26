/**
 * Install the vendored astrid-core (packages/astrid-rules/node) as lib/list-permissions.ts's
 * decider, the way instrumentation.ts does on the server (ADEV-304).
 *
 * Since step B there is no TypeScript permission rule: with nothing installed every check is a
 * refusal. So the shared vitest setup files call this, and a test that removes the decider
 * (`setListPermissionsCore(null)`) to exercise the refusal puts it back with this.
 *
 * It writes the same globalThis slot `setListPermissionsCore` does rather than importing
 * lib/list-permissions.ts, so a setup file that calls it does not load that module (and its
 * logger) ahead of a test file's own `vi.mock`s. Lazy: the wasm is only instantiated by the first
 * permission question a test file asks.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ListDecisionQuestion } from '@/lib/list-permissions'
import { createListPermissionsCore } from '@/lib/core-rules/list-permissions-decider'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')
const CORE_KEY = Symbol.for('astrid.listPermissions.core')

type Decide = (question: ListDecisionQuestion) => string | boolean | null | undefined
let decide: Decide | null = null

function decider(): Decide {
  if (!decide) {
    const glue = createRequire(path.join(PACKAGE_DIR, 'node', 'package.json'))('./astrid_rules_wasm.js') as {
      runJson(request: string): string
    }
    const revision = readFileSync(path.join(PACKAGE_DIR, 'REVISION'), 'utf8').trim()
    decide = createListPermissionsCore((request) => glue.runJson(request), { failure: () => {} }, { revision }).decide
  }
  return decide
}

export function installTestListPermissionsCore(): void {
  ;(globalThis as Record<symbol, unknown>)[CORE_KEY] = (question: ListDecisionQuestion) => decider()(question)
}
