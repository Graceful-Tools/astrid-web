/**
 * The passkey packages move in lockstep (AWTD-1398).
 *
 * SimpleWebAuthn releases `server` and `browser` together, but ours had drifted
 * four majors apart (13 vs 9), and the server's types arrived by accident from
 * `@simplewebauthn/types` — undeclared, deprecated upstream, and present only
 * because the old browser package pulled it in. Bumping the browser alone would
 * have dropped it from the tree and broken the server's imports.
 *
 * So: one major for both, the deprecated types package imported nowhere, and the
 * browser ceremonies called with the `{ optionsJSON }` shape v11+ expects. The
 * hook's options are `any`, so the compiler cannot catch the old positional call.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const major = (range: string | undefined) => range?.match(/(\d+)/)?.[1]

describe('passkey packages move in lockstep (AWTD-1398)', () => {
  it('declares @simplewebauthn/server and /browser at the same major', () => {
    const server = major(pkg.dependencies['@simplewebauthn/server'])
    const browser = major(pkg.dependencies['@simplewebauthn/browser'])
    expect(server).toBeDefined()
    expect(browser).toBe(server)
  })

  it('imports nothing from the deprecated @simplewebauthn/types', () => {
    const hits = execSync(
      `git grep -l "@simplewebauthn/types" -- '*.ts' '*.tsx' ':!tests/rules/passkey-packages-move-in-lockstep.test.ts' || true`,
      { cwd: root, encoding: 'utf8' },
    ).trim()
    expect(hits).toBe('')
  })

  it('calls the browser ceremonies with { optionsJSON }, not the old positional options', () => {
    const hook = readFileSync(join(root, 'hooks/use-webauthn.ts'), 'utf8')
    const calls = hook.match(/start(?:Registration|Authentication)\(([^)]*)\)/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(3)
    for (const call of calls) expect(call).toContain('optionsJSON')
  })
})
